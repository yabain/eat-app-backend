/**
 * Backfill des canaux de commande on-site sur les MenuItems existants.
 *
 * Les defaults Mongoose (`onSite: true`, `onDelivery: true`) ne s'appliquent
 * qu'aux documents créés après l'ajout des champs. Ce script met tous les
 * documents existants à niveau, et il est idempotent : les documents qui ont
 * déjà les deux champs ne sont jamais touchés (même une valeur `false`
 * explicite n'est pas écrasée).
 *
 * Usage :
 *   npm run backfill:menu-channels            # dry-run (compte seulement)
 *   npm run backfill:menu-channels -- --apply # applique le backfill
 */
import { config } from 'dotenv';
config();
import * as mongoose from 'mongoose';
import { MenuItemSchema } from '../database/schemas/menu-item.schema';

const APPLY = process.argv.includes('--apply');

async function run() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is not set in .env');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log(`Connected to MongoDB (apply: ${APPLY})`);

  const MenuItem = mongoose.model('MenuItem', MenuItemSchema);

  // Uniquement les documents où un des deux champs est absent : idempotent
  // par construction, et ne réactive pas un item volontairement désactivé.
  const filter = { $or: [{ onSite: { $exists: false } }, { onDelivery: { $exists: false } }] };
  const matched = await MenuItem.countDocuments(filter);
  console.log(`Menu items missing onSite/onDelivery: ${matched}`);

  if (matched === 0) {
    console.log('Nothing to backfill.');
    await mongoose.disconnect();
    return;
  }

  if (!APPLY) {
    console.log('Dry-run: re-run with `-- --apply` to set onSite=true, onDelivery=true on these documents.');
    await mongoose.disconnect();
    return;
  }

  const result = await MenuItem.updateMany(filter, { $set: { onSite: true, onDelivery: true } });
  console.log(`Backfilled ${result.modifiedCount} menu item(s).`);

  // Vérification : une seconde passe ne doit plus rien trouver.
  const remaining = await MenuItem.countDocuments(filter);
  console.log(`Remaining without channels: ${remaining}`);

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
