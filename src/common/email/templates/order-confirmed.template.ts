import { MailTemplate, renderMailLayout } from '../mail-layout';

export function orderConfirmedTemplate(input: { orderNumber: string; orderUrl?: string }): MailTemplate {
  return {
    subject: `Commande confirmée - ${input.orderNumber}`,
    html: renderMailLayout({
      preview: `Votre commande ${input.orderNumber} est confirmée.`,
      eyebrow: 'Commande',
      title: 'Paiement confirmé',
      intro: 'Votre paiement a été confirmé. Le restaurant peut maintenant traiter votre commande.',
      details: [{ label: 'Numéro de commande', value: input.orderNumber }],
      cta: input.orderUrl ? { label: 'Voir ma commande', url: input.orderUrl } : undefined,
    }),
  };
}
