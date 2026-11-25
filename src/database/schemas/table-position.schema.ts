import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
export type TablePositionDocument = HydratedDocument<TablePosition>;

/**
 * Position de table (siège) d'un restaurant, rattachée à une Table
 * (hiérarchie à deux niveaux : Table → positions). Identifiée publiquement
 * par un `idQr` encodé dans le QR code affiché sur le siège. Le scan du QR
 * ouvre /restaurant/yChat?idQr=<idQr> côté frontend.
 *
 * Décision D2 (plan « Tables > positions ») : `label` est OPTIONNEL — si
 * vide/absent à la création, le backend auto-génère « Siège N » où
 * N = countDocuments({ tableId }) + 1. Doublons de label ACCEPTÉS (pas
 * d'unicité dure) : après suppression d'un siège, « Siège 2 » peut être
 * re-généré pour un autre siège — sans conséquence métier, le QR est
 * l'identifiant réel. Le label sert seulement à l'admin pour distinguer les
 * QR imprimés.
 */
@Schema({ timestamps: true })
export class TablePosition {
  @Prop({ type: Types.ObjectId, ref: 'Restaurant', required: true }) restaurantId: Types.ObjectId;
  /** Table parente (dénormalisée du restaurant — le siège appartient à une table). */
  @Prop({ type: Types.ObjectId, ref: 'Table', required: true }) tableId: Types.ObjectId;
  /** 12 chars base64url, unique — porté par le QR imprimé sur le siège. */
  @Prop({ required: true, unique: true }) idQr: string;
  /** Optionnel : « Siège N » auto-généré si vide — voir décision D2. */
  @Prop({ maxlength: 100 }) label?: string;
  /** Position désactivée = QR inutilisable (scan → 404). */
  @Prop({ default: true }) isActive: boolean;
}
export const TablePositionSchema = SchemaFactory.createForClass(TablePosition);
TablePositionSchema.index({ tableId: 1, isActive: 1 });
TablePositionSchema.index({ restaurantId: 1, isActive: 1 });
