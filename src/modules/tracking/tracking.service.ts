import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { VisitActorType, VisitEvent, VisitEventDocument } from '../../database/schemas/visit-event.schema';
import { TrackVisitDto } from './dto/track-visit.dto';

type TrackingPeriod = 'day' | 'month' | 'year';

@Injectable()
export class TrackingService {
  private readonly timezone = 'Africa/Douala';

  constructor(@InjectModel(VisitEvent.name) private readonly visitModel: Model<VisitEventDocument>) {}

  async track(dto: TrackVisitDto, req: any) {
    const user = req.user;

    const path = this.normalizePath(dto.path);
    if (!path || this.isExcludedPath(path)) return { tracked: false };

    const visit = {
      eventId: String(dto.eventId || '').trim() || undefined,
      path,
      title: String(dto.title || '').trim(),
      sessionId: String(dto.sessionId || '').trim(),
      actorType: user?.sub ? VisitActorType.CLIENT : VisitActorType.VISITOR,
      userId: user?.sub && Types.ObjectId.isValid(user.sub) ? new Types.ObjectId(user.sub) : null,
      ip: this.ipFromRequest(req),
      userAgent: String(req.headers?.['user-agent'] || '').slice(0, 500),
    };

    if (visit.eventId) {
      await this.visitModel.updateOne(
        { eventId: visit.eventId },
        { $setOnInsert: visit },
        { upsert: true },
      );
    } else {
      await this.visitModel.create(visit);
    }

    return { tracked: true };
  }

  async stats(period: TrackingPeriod = 'day', dateValue?: string) {
    const range = this.rangeFor(period, dateValue);
    const filter: FilterQuery<VisitEventDocument> = {
      createdAt: { $gte: range.start, $lt: range.end },
    };

    const [totalVisits, periodVisits, totalVisitorSessions, periodVisitorSessions, rawSeries, pageStats] = await Promise.all([
      this.visitModel.countDocuments({}),
      this.visitModel.countDocuments(filter),
      this.visitModel.distinct('sessionId', { sessionId: { $nin: ['', null] } }),
      this.visitModel.distinct('sessionId', {
        ...filter,
        sessionId: { $nin: ['', null] },
      }),
      this.aggregateSeries(period, filter),
      this.aggregatePages(filter),
    ]);

    return {
      period,
      selectedDate: range.selectedDate,
      totalVisits,
      periodVisits,
      totalVisitors: totalVisitorSessions.length,
      periodVisitors: periodVisitorSessions.length,
      series: this.fillSeries(period, range, rawSeries),
      pages: pageStats,
      refreshedAt: new Date(),
    };
  }

  private aggregateSeries(period: TrackingPeriod, filter: FilterQuery<VisitEventDocument>) {
    const datePart = period === 'day' ? 'hour' : period === 'month' ? 'day' : 'month';
    return this.visitModel.aggregate([
      { $match: filter },
      {
        $group: {
          _id: { $dateToParts: { date: '$createdAt', timezone: this.timezone } },
          count: { $sum: 1 },
        },
      },
      {
        $project: {
          _id: 0,
          bucket: `$_id.${datePart}`,
          count: 1,
        },
      },
      { $sort: { bucket: 1 } },
    ]);
  }

  private aggregatePages(filter: FilterQuery<VisitEventDocument>) {
    return this.visitModel.aggregate([
      { $match: filter },
      {
        $group: {
          _id: '$path',
          visits: { $sum: 1 },
          visitors: { $addToSet: '$sessionId' },
        },
      },
      {
        $project: {
          _id: 0,
          path: '$_id',
          visits: 1,
          uniqueVisitors: {
            $size: {
              $filter: {
                input: '$visitors',
                as: 'visitor',
                cond: { $ne: ['$$visitor', ''] },
              },
            },
          },
        },
      },
      { $sort: { visits: -1, path: 1 } },
    ]);
  }

  private fillSeries(period: TrackingPeriod, range: { start: Date; selectedDate: string }, rows: Array<{ bucket: number; count: number }>) {
    const counts = new Map(rows.map((row) => [Number(row.bucket), Number(row.count || 0)]));
    const length = period === 'day' ? 24 : period === 'month' ? this.daysInSelectedMonth(range.selectedDate) : 12;
    const startIndex = period === 'day' ? 0 : 1;

    return Array.from({ length }, (_, index) => {
      const bucket = index + startIndex;
      return {
        bucket,
        label: this.labelFor(period, bucket),
        count: counts.get(bucket) || 0,
      };
    });
  }

  private labelFor(period: TrackingPeriod, bucket: number) {
    if (period === 'day') return `${String(bucket).padStart(2, '0')}h`;
    if (period === 'month') return String(bucket);
    return ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc'][bucket - 1] || String(bucket);
  }

  private rangeFor(period: TrackingPeriod, dateValue?: string) {
    const now = new Date();
    const input = String(dateValue || '').trim();
    const base = input ? new Date(input) : now;
    const valid = Number.isNaN(base.getTime()) ? now : base;

    if (period === 'year') {
      const year = input && /^\d{4}$/.test(input) ? Number(input) : this.parts(valid).year;
      return {
        selectedDate: String(year),
        start: this.doualaLocalDateToUtc(year, 1, 1),
        end: this.doualaLocalDateToUtc(year + 1, 1, 1),
      };
    }

    if (period === 'month') {
      const match = input.match(/^(\d{4})-(\d{2})$/);
      const parts = this.parts(valid);
      const year = match ? Number(match[1]) : parts.year;
      const month = match ? Number(match[2]) : parts.month;
      return {
        selectedDate: `${year}-${String(month).padStart(2, '0')}`,
        start: this.doualaLocalDateToUtc(year, month, 1),
        end: this.doualaLocalDateToUtc(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1, 1),
      };
    }

    const parts = this.parts(valid);
    const selectedDate = input && /^\d{4}-\d{2}-\d{2}$/.test(input)
      ? input
      : `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
    const [year, month, day] = selectedDate.split('-').map(Number);
    return {
      selectedDate,
      start: this.doualaLocalDateToUtc(year, month, day),
      end: this.doualaLocalDateToUtc(year, month, day + 1),
    };
  }

  private parts(date: Date) {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: this.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = formatter.formatToParts(date);
    return {
      year: Number(parts.find((part) => part.type === 'year')?.value),
      month: Number(parts.find((part) => part.type === 'month')?.value),
      day: Number(parts.find((part) => part.type === 'day')?.value),
    };
  }

  private daysInSelectedMonth(selectedDate: string) {
    const [year, month] = selectedDate.split('-').map(Number);
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
  }

  private doualaLocalDateToUtc(year: number, month: number, day: number) {
    return new Date(Date.UTC(year, month - 1, day, -1, 0, 0, 0));
  }

  private normalizePath(path: string) {
    return String(path || '').split('?')[0].replace(/\/+$/, '') || '/';
  }

  private isExcludedPath(path: string) {
    return ['/admin', '/manager', '/driver'].some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
  }

  private ipFromRequest(req: any) {
    const forwarded = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
    return forwarded || req.ip || req.socket?.remoteAddress || '';
  }
}
