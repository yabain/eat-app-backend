import { MailTemplate, renderMailLayout } from '../mail-layout';

export function menuItemAvailableTemplate(input: {
  firstName?: string;
  menuItemName: string;
  restaurantName?: string;
  menuItemUrl?: string;
}): MailTemplate {
  const restaurant = input.restaurantName ? ` chez ${input.restaurantName}` : '';
  return {
    subject: `${input.menuItemName} est à nouveau disponible !`,
    html: renderMailLayout({
      preview: `${input.menuItemName} vient d'être remis en vente${restaurant}.`,
      eyebrow: 'Favori disponible',
      title: `Bonne nouvelle ${input.firstName || ''} !`,
      intro: `Le plat <strong>${input.menuItemName}</strong> que vous avez ajouté à vos favoris est de nouveau disponible${restaurant}. Commandez-le avant rupture.`,
      details: [
        { label: 'Plat', value: input.menuItemName },
        ...(input.restaurantName ? [{ label: 'Restaurant', value: input.restaurantName }] : []),
      ],
      cta: input.menuItemUrl ? { label: 'Commander maintenant', url: input.menuItemUrl } : undefined,
    }),
  };
}
