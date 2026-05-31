import { MailTemplate, renderMailLayout } from '../mail-layout';

export type RestaurantOrderConfirmedItem = {
  name: string;
  quantity: number;
  subtotal: number;
};

export function restaurantOrderConfirmedTemplate(input: {
  orderNumber: string;
  restaurantName?: string;
  clientName?: string;
  clientPhone?: string;
  address?: string;
  total?: number;
  items?: RestaurantOrderConfirmedItem[];
  orderUrl?: string;
}): MailTemplate {
  const items = (input.items || [])
    .map((item) => `${item.quantity} x ${item.name} (${item.subtotal} XAF)`)
    .join('\n');

  return {
    subject: `Nouvelle commande payee - ${input.orderNumber}`,
    html: renderMailLayout({
      preview: `La commande ${input.orderNumber} vient d'etre confirmee.`,
      eyebrow: 'Restaurant',
      title: 'Nouvelle commande payee',
      intro: 'Un paiement client vient d etre confirme. La commande peut maintenant etre traitee par le restaurant.',
      body: items ? `Articles:\n${items}` : undefined,
      details: [
        { label: 'Numero de commande', value: input.orderNumber },
        { label: 'Restaurant', value: input.restaurantName },
        { label: 'Client', value: input.clientName },
        { label: 'Telephone client', value: input.clientPhone },
        { label: 'Adresse', value: input.address },
        { label: 'Total', value: input.total !== undefined ? `${input.total} XAF` : undefined },
      ],
      cta: input.orderUrl ? { label: 'Voir la commande', url: input.orderUrl } : undefined,
      note: 'Merci de confirmer rapidement la commande et de demarrer la preparation.',
    }),
  };
}
