import { MailTemplate, renderMailLayout } from '../mail-layout';

export function orderDeliveredTemplate(input: { orderNumber: string; orderUrl?: string }): MailTemplate {
  return {
    subject: `Commande livrée - ${input.orderNumber}`,
    html: renderMailLayout({
      preview: `Votre commande *${input.orderNumber}* a été livrée.`,
      eyebrow: 'Livraison',
      title: 'Commande livrée',
      intro: 'Votre commande a été livrée. Merci d’avoir utilisé Eat App.',
      details: [{ label: 'Numéro de commande', value: input.orderNumber }],
      cta: input.orderUrl ? { label: 'Voir le reçu', url: input.orderUrl } : undefined,
    }),
  };
}
