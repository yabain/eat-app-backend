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
    subject: `Livraison assignee - ${input.orderNumber}`,
    html: renderMailLayout({
      preview: `La commande ${input.orderNumber} vous a ete assignee.`,
      eyebrow: 'Livraison',
      title: 'Nouvelle livraison assignee',
      intro: `Bonjour ${input.driverName || ''}, une commande vous a ete assignee pour livraison.`.trim(),
      details: [
        { label: 'Numero de commande', value: input.orderNumber },
        { label: 'Restaurant', value: input.restaurantName },
        { label: 'Client', value: input.clientName },
        { label: 'Telephone client', value: input.clientPhone },
        { label: 'Adresse de livraison', value: input.address },
        { label: 'Total commande', value: input.total !== undefined ? `${input.total} XAF` : undefined },
      ],
      cta: input.orderUrl ? { label: 'Voir la livraison', url: input.orderUrl } : undefined,
      note: 'Consultez votre espace livreur pour demarrer la livraison et mettre a jour son statut.',
    }),
  };
}
