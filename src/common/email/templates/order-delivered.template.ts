import { MailTemplate, renderMailLayout } from '../mail-layout';

export function orderDeliveredTemplate(input: { orderNumber: string; orderUrl?: string }): MailTemplate {
  return {
    subject: `Commande livree - ${input.orderNumber}`,
    html: renderMailLayout({
      preview: `Votre commande ${input.orderNumber} a ete livree.`,
      eyebrow: 'Livraison',
      title: 'Commande livree',
      intro: 'Votre commande a ete livree. Merci d’avoir utilise Eat App.',
      details: [{ label: 'Numero de commande', value: input.orderNumber }],
      cta: input.orderUrl ? { label: 'Voir le recu', url: input.orderUrl } : undefined,
    }),
  };
}
