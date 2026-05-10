import { MailTemplate, renderMailLayout } from '../mail-layout';

export function orderConfirmedTemplate(input: { orderNumber: string; orderUrl?: string }): MailTemplate {
  return {
    subject: `Commande confirmee - ${input.orderNumber}`,
    html: renderMailLayout({
      preview: `Votre commande ${input.orderNumber} est confirmee.`,
      eyebrow: 'Commande',
      title: 'Paiement confirme',
      intro: 'Votre paiement a ete confirme. Le restaurant peut maintenant traiter votre commande.',
      details: [{ label: 'Numero de commande', value: input.orderNumber }],
      cta: input.orderUrl ? { label: 'Voir ma commande', url: input.orderUrl } : undefined,
    }),
  };
}
