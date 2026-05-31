import { MailTemplate, renderMailLayout } from '../mail-layout';

export function deliveryAssignedTemplate(input: {
  orderNumber: string;
  driverName?: string;
  restaurantName?: string;
  clientName?: string;
  clientPhone?: string;
  address?: string;
  total?: number;
  orderUrl?: string;
}): MailTemplate {
  return {
    subject: `Livraison assignée - ${input.orderNumber}`,
    html: renderMailLayout({
      preview: `La commande ${input.orderNumber} vous a été assignée.`,
      eyebrow: 'Livraison',
      title: 'Nouvelle livraison assignée',
      intro: `Bonjour ${input.driverName || ''}, une commande vous a été assignée pour livraison.`.trim(),
      details: [
        { label: 'Numéro de commande', value: input.orderNumber },
        { label: 'Restaurant', value: input.restaurantName },
        { label: 'Client', value: input.clientName },
        { label: 'Téléphone client', value: input.clientPhone },
        { label: 'Adresse de livraison', value: input.address },
        // { label: 'Total commande', value: input.total !== undefined ? `${input.total} XAF` : undefined },
      ],
      cta: input.orderUrl ? { label: 'Voir la livraison', url: input.orderUrl } : undefined,
      note: 'Consultez votre espace livreur pour démarrer la livraison et mettre à jour son statut.',
    }),
  };
}
