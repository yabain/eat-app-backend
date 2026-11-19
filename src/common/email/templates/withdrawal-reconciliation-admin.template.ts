import { MailTemplate, renderMailLayout } from '../mail-layout';

/**
 * Alerte admin : un retrait doit être vérifié manuellement (TTL d'idempotence
 * dépassée, gateway injoignable sans confirmation, ou succès provider arrivé
 * après un remboursement). Les fonds n'ont PAS été recrédités automatiquement.
 */
export function withdrawalReconciliationAdminTemplate(input: {
  amount: number;
  currency?: string;
  phone?: string;
  ownerType?: string;
  ownerLabel?: string;
  withdrawalId?: string;
  providerStatus?: string;
  errorDetail?: string;
}): MailTemplate {
  const currency = input.currency || 'XAF';
  const amount = `${Number(input.amount || 0).toLocaleString('fr-FR')} ${currency}`;
  return {
    subject: `[Eat App] Retrait à réconcilier ${amount}`,
    html: renderMailLayout({
      preview: `Un retrait de ${amount} nécessite une vérification manuelle sur Eat App.`,
      eyebrow: 'Réconciliation retrait',
      title: 'Un retrait nécessite une vérification manuelle',
      intro:
        `Un retrait de ${amount} n'a pas pu être résolu automatiquement. ` +
        'Les fonds sont conservés et le solde n’a PAS été recrédité : vérifiez le statut réel côté DigiKuntz avant toute action.',
      details: [
        { label: 'Montant', value: amount },
        ...(input.phone ? [{ label: 'Numéro destinataire', value: input.phone }] : []),
        ...(input.ownerLabel
          ? [{ label: input.ownerType === 'restaurant' ? 'Restaurant' : 'Demandeur', value: input.ownerLabel }]
          : []),
        ...(input.withdrawalId ? [{ label: 'Identifiant retrait', value: input.withdrawalId }] : []),
        ...(input.providerStatus ? [{ label: 'Statut provider', value: input.providerStatus }] : []),
        ...(input.errorDetail ? [{ label: 'Détail', value: input.errorDetail }] : []),
      ],
    }),
  };
}