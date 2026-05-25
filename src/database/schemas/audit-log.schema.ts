import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type AuditLogDocument = HydratedDocument<AuditLog>;

@Schema({ timestamps: true })
export class AuditLog {
  @Prop({ type: Types.ObjectId, ref: 'User', default: null }) actorId?: Types.ObjectId | null;
  @Prop() actorEmail?: string;
  @Prop() actorRole?: string;

  // Format: "<resource>.<verb>"  e.g. "category.create", "user.delete",
  // "menu_item.reset_midnight_stocks". Sert de filtre et de libellé humanisé.
  @Prop({ required: true }) action: string;

  @Prop() resourceType?: string;
  @Prop() resourceId?: string;
  @Prop() resourceLabel?: string;

  // Snapshot libre (request body sanitizé, summary metiers, etc.)
  @Prop({ type: Object }) metadata?: Record<string, any>;

  @Prop() method?: string;
  @Prop() path?: string;
  @Prop() statusCode?: number;
  @Prop() durationMs?: number;

  @Prop() ip?: string;
  @Prop() userAgent?: string;
}

export const AuditLogSchema = SchemaFactory.createForClass(AuditLog);

// Index pour les requêtes admin: tri par date desc + filtres.
AuditLogSchema.index({ createdAt: -1 });
AuditLogSchema.index({ actorId: 1, createdAt: -1 });
AuditLogSchema.index({ action: 1, createdAt: -1 });
AuditLogSchema.index({ resourceType: 1, resourceId: 1, createdAt: -1 });
