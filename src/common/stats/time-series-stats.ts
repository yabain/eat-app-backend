import { FilterQuery, Model } from 'mongoose';

export type StatsPeriod = 'day' | 'month' | 'year';

const TIMEZONE = 'Africa/Douala';

export function normalizeStatsPeriod(period?: string): StatsPeriod {
  return period === 'month' || period === 'year' ? period : 'day';
}

export function buildStatsRange(period: StatsPeriod, dateValue?: string) {
  const now = new Date();
  const input = String(dateValue || '').trim();
  const base = input ? new Date(input) : now;
  const valid = Number.isNaN(base.getTime()) ? now : base;

  if (period === 'year') {
    const year = input && /^\d{4}$/.test(input) ? Number(input) : dateParts(valid).year;
    return {
      selectedDate: String(year),
      start: doualaLocalDateToUtc(year, 1, 1),
      end: doualaLocalDateToUtc(year + 1, 1, 1),
    };
  }

  if (period === 'month') {
    const match = input.match(/^(\d{4})-(\d{2})$/);
    const parts = dateParts(valid);
    const year = match ? Number(match[1]) : parts.year;
    const month = match ? Number(match[2]) : parts.month;
    return {
      selectedDate: `${year}-${String(month).padStart(2, '0')}`,
      start: doualaLocalDateToUtc(year, month, 1),
      end: doualaLocalDateToUtc(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1, 1),
    };
  }

  const parts = dateParts(valid);
  const selectedDate = input && /^\d{4}-\d{2}-\d{2}$/.test(input)
    ? input
    : `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
  const [year, month, day] = selectedDate.split('-').map(Number);
  return {
    selectedDate,
    start: doualaLocalDateToUtc(year, month, day),
    end: doualaLocalDateToUtc(year, month, day + 1),
  };
}

export async function buildTimeSeriesStats(
  model: Model<any>,
  periodInput?: string,
  dateValue?: string,
  baseFilter: FilterQuery<any> = {},
) {
  const period = normalizeStatsPeriod(periodInput);
  const range = buildStatsRange(period, dateValue);
  const periodFilter: FilterQuery<any> = {
    ...baseFilter,
    createdAt: { $gte: range.start, $lt: range.end },
  };
  const [total, periodTotal, rawSeries] = await Promise.all([
    model.countDocuments(baseFilter),
    model.countDocuments(periodFilter),
    aggregateSeries(model, period, periodFilter),
  ]);

  return {
    period,
    selectedDate: range.selectedDate,
    total,
    periodTotal,
    series: fillSeries(period, range.selectedDate, rawSeries),
    refreshedAt: new Date(),
  };
}

function aggregateSeries(model: Model<any>, period: StatsPeriod, filter: FilterQuery<any>) {
  const datePart = period === 'day' ? 'hour' : period === 'month' ? 'day' : 'month';
  return model.aggregate([
    { $match: filter },
    {
      $project: {
        dateParts: { $dateToParts: { date: '$createdAt', timezone: TIMEZONE } },
      },
    },
    { $project: { bucket: `$dateParts.${datePart}` } },
    {
      $group: {
        _id: '$bucket',
        count: { $sum: 1 },
      },
    },
    { $project: { _id: 0, bucket: '$_id', count: 1 } },
    { $sort: { bucket: 1 } },
  ]);
}

function fillSeries(period: StatsPeriod, selectedDate: string, rows: Array<{ bucket: number; count: number }>) {
  const counts = rows.reduce((map, row) => {
    const bucket = Number(row.bucket);
    map.set(bucket, (map.get(bucket) || 0) + Number(row.count || 0));
    return map;
  }, new Map<number, number>());
  const length = period === 'day' ? 24 : period === 'month' ? daysInSelectedMonth(selectedDate) : 12;
  const startIndex = period === 'day' ? 0 : 1;
  return Array.from({ length }, (_, index) => {
    const bucket = index + startIndex;
    return { bucket, label: labelFor(period, bucket), count: counts.get(bucket) || 0 };
  });
}

function labelFor(period: StatsPeriod, bucket: number) {
  if (period === 'day') return `${String(bucket).padStart(2, '0')}h`;
  if (period === 'month') return String(bucket);
  return ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc'][bucket - 1] || String(bucket);
}

function dateParts(date: Date) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
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

function daysInSelectedMonth(selectedDate: string) {
  const [year, month] = selectedDate.split('-').map(Number);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function doualaLocalDateToUtc(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month - 1, day, -1, 0, 0, 0));
}
