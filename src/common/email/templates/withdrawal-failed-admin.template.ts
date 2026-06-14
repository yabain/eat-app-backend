import { MailTemplate, renderMailLayout } from '../mail-layout';

export function withdrawalFailedAdminTemplate(input: {
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
    subject: `[Eat App] Échec de retrait ${amount}`,
    html: renderMailLayout({
      preview: `Échec d'un retrait de ${amount} sur Eat App. Solde recrédité automatiquement.`,
      eyebrow: 'Alerte retrait',
      title: 'Un retrait a échoué côté opérateur mobile',
      intro:
        `Un retrait de <strong>${amount}</strong> n'a pas pu être finalisé par le provider de paiement. ` +
        'Le solde du demandeur a été automatiquement recrédité. Vérifiez le statut côté DigiKuntz.',
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
