import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
export type DeliveryZoneDocument = HydratedDocument<DeliveryZone>;

@Schema({ timestamps: true })
export class DeliveryZone {
  @Prop({ required: true }) city: string;
  @Prop({ required: true }) district: string;
  @Prop() details?: string;
  @Prop() mapLink?: string;
  @Prop({ required: true }) deliveryFee: number;
  @Prop({ type: Number, default: 0 }) time: number;
  @Prop({ default: true }) isActive: boolean;
  /**
   * Identifiant logique de regroupement (ex: "Z01", "ZONE-A", "1"). Sert au
   * cron de dispatch automatique pour grouper les commandes prêtes d'un même
   * restaurant et d'une même zone numérique vers le même livreur (cf.
   * DeliveriesService.runAutomaticDispatch). Optionnel : sans valeur, chaque
   * commande de la zone est dispatchée individuellement.
   */
  @Prop({ trim: true }) zoneNumber?: string;
}
export const DeliveryZoneSchema = SchemaFactory.createForClass(DeliveryZone);
DeliveryZoneSchema.index({ city: 1, district: 1 });
