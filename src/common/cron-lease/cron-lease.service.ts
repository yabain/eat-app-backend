import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CronLease, CronLeaseDocument } from '../../database/schemas/cron-lease.schema';

/**
 * Service de lease lock distribué pour les crons multi-instances.
 *
 * Toute exécution de cron qui a des effets de bord (modification de solde,
 * envoi de webhook/email, déclenchement de paiement, etc.) doit être
 * protégée par un lease : seul un nœud à la fois acquiert le lock dans la
 * fenêtre de `ttlMs`, les autres skip leur tick.
 *
 * Au-delà de l'optimisation (éviter le travail dupliqué), c'est une couche
 * de défense complémentaire à l'idempotence métier (upsert + upsertedCount).
 */
@Injectable()
export class CronLeaseService {
  private readonly logger = new Logger(CronLeaseService.name);
  private readonly instanceId = `${
    process.env.INSTANCE_ID || process.env.HOSTNAME || 'unknown'
  }-${process.pid}`;

  constructor(
    @InjectModel(CronLease.name) private readonly leaseModel: Model<CronLeaseDocument>,
  ) {}

  /**
   * Tente d'acquérir le lock `name` pour `ttlMs` millisecondes.
   * Renvoie `true` si l'instance détient désormais le lock (le caller doit
   * exécuter sa tâche), `false` sinon (le tick est ignoré).
   */
  async acquire(name: string, ttlMs: number): Promise<boolean> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlMs);
    try {
      const result = await this.leaseModel.findOneAndUpdate(
        { name, expiresAt: { $lte: now } },
        { $set: { name, holder: this.instanceId, expiresAt } },
        { upsert: true, new: true },
      );
      return result?.holder === this.instanceId;
    } catch (error: any) {
      // E11000 : un autre nœud a inséré la même clé en concurrence — c'est
      // lui qui détient le lease, pas nous.
      if (error?.code === 11000) return false;
      this.logger.warn(`acquire(${name}) failed: ${error?.message || error}`);
      return false;
    }
  }
}
