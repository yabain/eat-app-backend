import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
export type TableDocument = HydratedDocument<Table>;

/**
 * Table d'un restaurant (ex. « Table 3 », « Terrasse 1 ») : conteneur de
 * premier niveau qui regroupe plusieurs positions (sièges), chacune avec son
 * QR unique. Le chat de groupe yChat est partagé PAR TABLE (room
 * `table:<tableId>`), quel que soit le siège scanné.
 *
 * Décision D1 (plan « Tables > positions ») : PAS d'unicité stricte sur
 * `label` au sein d'un restaurant — les labels sont de la saisie humaine
 * (« Table 3 » peut exister en salle + terrasse) et imposer l'unicité
 * créerait des erreurs frustrantes sans valeur métier (le QR est par
 * position, pas par label). La déduplication visuelle est laissée à
 * l'utilisateur. L'index non-unique sert au scoping des listes.
 */
@Schema({ timestamps: true })
export class Table {
  @Prop({ type: Types.ObjectId, ref: 'Restaurant', required: true }) restaurantId: Types.ObjectId;
  /** Label libre (ex. « Table 3 », « Terrasse 1 ») — maxlength 100. */
  @Prop({ required: true, minlength: 1, maxlength: 100 }) label: string;
  /** Table désactivée = join socket refusé (join:error) pour les clients yChat. */
  @Prop({ default: true }) isActive: boolean;
}
export const TableSchema = SchemaFactory.createForClass(Table);
TableSchema.index({ restaurantId: 1, isActive: 1 });
