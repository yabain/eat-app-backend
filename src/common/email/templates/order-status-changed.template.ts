import { MailTemplate, renderMailLayout } from '../mail-layout';

export function orderStatusChangedTemplate(input: { orderNumber: string; status: string; orderUrl?: string }): MailTemplate {
  return {
    subject: `Mise à jour de commande - ${input.orderNumber}`,
    html: renderMailLayout({
      preview: `Le statut de votre commande ${input.orderNumber} a changé.`,
      eyebrow: 'Suivi commande',
      title: 'Statut de commande mis à jour',
      intro: 'Le statut de votre commande vient d’être mis à jour.',
      details: [
        { label: 'Numéro de commande', value: input.orderNumber },
        { label: 'Nouveau statut', value: input.status },
      ],
      cta: input.orderUrl ? { label: 'Suivre ma commande', url: input.orderUrl } : undefined,
    }),
  };
}
