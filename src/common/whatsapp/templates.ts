type OrderItem = {
  name: string;
  quantity: number;
  subtotal: number;
};

function lines(values: Array<string | undefined | null | false>) {
  return [
    ...values.filter(Boolean),
    '',
    '> Ceci est un message automatique de Eat App',
  ].join('\n');
}

function money(value?: number) {
  return value !== undefined && value !== null ? `${Number(value).toLocaleString('fr-FR')} XAF` : undefined;
}

function link(label: string, url?: string) {
  return url ? `${label}\n${url}` : undefined;
}

export function accountCreatedWhatsappTemplate(input: { firstName?: string; loginUrl?: string }) {
  return lines([
    `Bonjour ${input.firstName || ' chèr utilisateur'},`,
    '\n',
    `Toute l'équipe de Eat vous souhaite la bienvenue !`,
    'Vous pouvez désormais commander vos repas et suivre vos commandes depuis votre espace client.\n',
    link('Ouvrir Eat App:', input.loginUrl),
  ]);
}

export function resetPasswordWhatsappTemplate(input: { resetLink: string; expiresIn?: string; firstName?: string; }) {
  return lines([
    '*Réinitialisation de votre mot de passe Eat App*',
    '\n',
    `Cher(e) *${input.firstName || 'Utilisateur'}*,`,
    'Vous avez demandé la réinitialisation de votre mot de passe \n',
    `Le lien de réinitialisation est valable ${input.expiresIn || '1 heure'}`,
    link('Votre lien:', input.resetLink),
    '\n',
    "`Si vous n'êtes pas à l'origine de cette demande, veuillez ignorez ce message.`",
  ]);
}

export function passwordChangedWhatsappTemplate(input: { firstName?: string; loginUrl?: string }) {
  return lines([
    `*Mot de passe à jour*`,
    '\n',
    `${input.firstName || ''}, votre mot de passe *Eat App* a été modifié avec succès.`,
    "Si cette action ne vient pas de vous, contactez rapidement l'équipe Eat App.",
    '\n',
    link('Se connecter:', input.loginUrl),
  ]);
}

export function orderConfirmedWhatsappTemplate(input: { orderNumber: string; orderUrl?: string }) {
  return lines([
    '*Paiement confirmé*',
    '\n',
    `Votre commande _${input.orderNumber}_ est confirmée.`,
    'Le restaurant débute le traitement et vous serez notifié à chaque changement d\'état de votre commande',
    '\n',
    link('Suivre ma commande:', input.orderUrl),
  ]);
}

export function restaurantOrderConfirmedWhatsappTemplate(input: {
  orderNumber: string;
  restaurantName?: string;
  clientName?: string;
  clientPhone?: string;
  address?: string;
  total?: number;
  items?: OrderItem[];
  orderUrl?: string;
}) {
  const items = (input.items || [])
    .map((item) => `- ${item.quantity} x ${item.name} (${money(item.subtotal)})`)
    .join('\n');

  return lines([
    '*Nouvelle commande payée*',
    '\n',
    `Commande: *${input.orderNumber}*`,
    input.restaurantName ? `Restaurant: *${input.restaurantName}*` : undefined,
    input.clientName ? `Client: *${input.clientName}*` : undefined,
    input.clientPhone ? `Téléphone client: *${input.clientPhone}*` : undefined,
    input.address ? `Adresse: _${input.address}_` : undefined,
    input.total !== undefined ? `Total: *${money(input.total)}*` : undefined,
    items ? `\nArticles:\n${items}` : undefined,
    '\n',
    '`Merci de confirmer rapidement la commande et de démarrer la préparation.`',
    link('Voir la commande:', input.orderUrl),
  ]);
}

export function restaurantPreparationReminderWhatsappTemplate(input: {
  orderNumber: string;
  restaurantName?: string;
  elapsedMinutes?: number;
  orderUrl?: string;
}) {
  return lines([
    '*Rappel de préparation*',
    '\n',
    `La commande *${input.orderNumber}* attend toujours d’être marquée comme prête.`,
    input.restaurantName ? `Restaurant: *${input.restaurantName}*` : undefined,
    input.elapsedMinutes ? `Temps écoulé: plus de *${input.elapsedMinutes} minutes*` : undefined,
    '\n',
    '`Merci d’accélérer sa préparation et de mettre son statut à jour.`',
    link('Voir la commande:', input.orderUrl),
  ]);
}

export function deliveryAssignedWhatsappTemplate(input: {
  orderNumber: string;
  driverName?: string;
  restaurantName?: string;
  clientName?: string;
  clientPhone?: string;
  address?: string;
  total?: number;
  orderUrl?: string;
}) {
  return lines([
    '*Nouvelle livraison*',
    '\n',
    `Commande: *${input.orderNumber}*`,
    input.restaurantName ? `Restaurant: ${input.restaurantName}` : undefined,
    input.clientName ? `Client: ${input.clientName}` : undefined,
    input.clientPhone ? `Téléphone client: ${input.clientPhone}` : undefined,
    input.address ? `Adresse: _${input.address}_` : undefined,
    `Livreur en charge: *${input.driverName || 'Driver'}*,`.trim(),
    `\n`,
    link('Voir la livraison:', input.orderUrl),
  ]);
}

export function deliveryStartReminderWhatsappTemplate(input: {
  orderNumber: string;
  driverName?: string;
  restaurantName?: string;
  address?: string;
  elapsedMinutes?: number;
  orderUrl?: string;
}) {
  return lines([
    '*Rappel de livraison*',
    '\n',
    `${input.driverName || 'Livreur'}, la commande *${input.orderNumber}* vous est assignée, mais la course n’a pas encore démarré.`,
    input.restaurantName ? `Restaurant: ${input.restaurantName}` : undefined,
    input.address ? `Destination: _${input.address}_` : undefined,
    input.elapsedMinutes ? `Temps écoulé: plus de *${input.elapsedMinutes} minutes*` : undefined,
    '\n',
    '`Merci de prendre en charge la livraison et de mettre son statut à jour.`',
    link('Voir la livraison:', input.orderUrl),
  ]);
}

export function deliveryStartedWhatsappTemplate(input: {
  orderNumber: string;
  orderUrl?: string;
}) {
  return lines([
    '*Votre livraison est en route*',
    '\n',
    `Le livreur vient de démarrer la course pour votre commande *${input.orderNumber}*.`,
    'Vous pouvez suivre son évolution depuis votre espace client.',
    '\n',
    link('Suivre ma commande:', input.orderUrl),
  ]);
}

export function orderStatusChangedWhatsappTemplate(input: { orderNumber: string; status: string; orderUrl?: string }) {
  return lines([
    '*Mise à jour de la commande*',
    '\n',
    `Commande: *${input.orderNumber}*`,
    `Nouveau statut: *${input.status}*`,
    '\n',
    link('Suivre ma commande:', input.orderUrl),
  ]);
}

export function orderDeliveredWhatsappTemplate(input: { orderNumber: string; orderUrl?: string }) {
  return lines([
    '*Commande livrée*',
    '\n',
    `Votre commande ${input.orderNumber} a été livrée.`,
    'Merci d’avoir de faire confiance en Eat App.',
    'N’hésitez pas à noter et laisser un commentaire sur restaurant ainsi que sur les plats.',
    '\n',
    link('Voir le reçu:', input.orderUrl),
  ]);
}

export function menuItemAvailableWhatsappTemplate(input: {
  firstName?: string;
  menuItemName: string;
  restaurantName?: string;
  menuItemUrl?: string;
}) {
  const restaurant = input.restaurantName ? ` chez *${input.restaurantName}*` : '';
  return lines([
    `*${input.menuItemName} est à nouveau disponible !*`,
    '\n',
    `Bonjour ${input.firstName || ''},`,
    `Le plat *${input.menuItemName}* que vous avez ajouté à vos favoris est de nouveau disponible${restaurant}.`,
    'Commandez-le avant rupture.',
    '\n',
    link('Commander:', input.menuItemUrl),
  ]);
}
