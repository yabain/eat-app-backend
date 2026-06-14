import { MailTemplate, renderMailLayout } from '../mail-layout';

export function withdrawalFailedUserTemplate(input: {
  firstName?: string;
  amount: number;
  currency?: string;
  phone?: string;
  withdrawalId?: string;
}): MailTemplate {
  const currency = input.currency || 'XAF';
  const amount = `${Number(input.amount || 0).toLocaleString('fr-FR')} ${currency}`;
  return {
    subject: 'Retrait non abouti — un léger souci réseau',
    html: renderMailLayout({
      preview: `Votre retrait de ${amount} n'a pas pu être traité par votre opérateur mobile.`,
      eyebrow: 'Retrait',
      title: `Bonjour ${input.firstName || ''},`,
      intro:
        `Nous n'avons pas pu finaliser votre retrait de <strong>${amount}</strong>` +
        (input.phone ? ` vers le numéro <strong>${input.phone}</strong>` : '') +
        ' en raison d\'un léger souci d\'indisponibilité du réseau mobile. ' +
        'Votre solde a été immédiatement recrédité du montant correspondant. ' +
        'Vous pouvez relancer l\'opération dans quelques minutes depuis votre espace Eat App.',
      details: [
        { label: 'Montant', value: amount },
        ...(input.phone ? [{ label: 'Numéro', value: input.phone }] : []),
        ...(input.withdrawalId ? [{ label: 'Référence', value: input.withdrawalId }] : []),
      ],
    }),
  };
}
