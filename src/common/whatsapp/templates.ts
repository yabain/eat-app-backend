type OrderItem = {
  name: string;
  quantity: number;
  subtotal: number;
};

function lines(values: Array<string | undefined | null | false>) {
  return [
    ...values.filter(Boolean),
    '',
    '> Ceci est un message automatique de Eat',
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
    'Vous pouvez maintenant commander vos repas et suivre vos commandes depuis votre espace client.\n',
    link('Ouvrir Eat App:', input.loginUrl),
  ]);
}

export function resetPasswordWhatsappTemplate(input: { resetLink: string; expiresIn?: string; firstName?: string; }) {
  return lines([
    '*Réinitialisation de votre mot de passe Eat App*',
    '',
    `Cher(e) *${input.firstName || 'Utilisateur'}*,`,
    'Vous avez demandé la réinitialisation de votre mot de passe Eat App.',
    `Le lien de réinitialisation est valable ${input.expiresIn || '1 heure'}`,
    input.resetLink,
    '',
    link('Votre lien:', input.resetLink),
    '',
    '',
    "Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.",
  ]);
}

export function passwordChangedWhatsappTemplate(input: { firstName?: string; loginUrl?: string }) {
  return lines([
    `Bonjour ${input.firstName || ''},`.trim(),
    'Votre mot de passe Eat App a été modifié avec succès.',
    "Si cette action ne vient pas de vous, contactez rapidement l'équipe Eat App.",
    link('Se connecter:', input.loginUrl),
  ]);
}

export function orderConfirmedWhatsappTemplate(input: { orderNumber: string; orderUrl?: string }) {
  return lines([
    'Paiement confirmé',
    '',
    `Votre commande ${input.orderNumber} est confirmée.`,
    'Le restaurant peut maintenant traiter votre commande.',
    link('Voir ma commande:', input.orderUrl),
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
    'Nouvelle commande payée',
    '',
    `Commande: ${input.orderNumber}`,
    input.restaurantName ? `Restaurant: ${input.restaurantName}` : undefined,
    input.clientName ? `Client: ${input.clientName}` : undefined,
    input.clientPhone ? `Téléphone client: ${input.clientPhone}` : undefined,
    input.address ? `Adresse: ${input.address}` : undefined,
    input.total !== undefined ? `Total: ${money(input.total)}` : undefined,
    items ? `\nArticles:\n${items}` : undefined,
    '',
    'Merci de confirmer rapidement la commande et de démarrer la préparation.',
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
    `Bonjour ${input.driverName || ''},`.trim(),
    '',
    'Nouvelle livraison assignée.',
    `Commande: ${input.orderNumber}`,
    input.restaurantName ? `Restaurant: ${input.restaurantName}` : undefined,
    input.clientName ? `Client: ${input.clientName}` : undefined,
    input.clientPhone ? `Téléphone client: ${input.clientPhone}` : undefined,
    input.address ? `Adresse: ${input.address}` : undefined,
    input.total !== undefined ? `Total commande: ${money(input.total)}` : undefined,
    link('Voir la livraison:', input.orderUrl),
  ]);
}

export function orderStatusChangedWhatsappTemplate(input: { orderNumber: string; status: string; orderUrl?: string }) {
  return lines([
    'Mise à jour de commande',
    '',
    `Commande: ${input.orderNumber}`,
    `Nouveau statut: ${input.status}`,
    link('Suivre ma commande:', input.orderUrl),
  ]);
}

export function orderDeliveredWhatsappTemplate(input: { orderNumber: string; orderUrl?: string }) {
  return lines([
    'Commande livrée',
    '',
    `Votre commande ${input.orderNumber} a été livrée.`,
    'Merci d’avoir utilisé Eat App.',
    link('Voir le reçu:', input.orderUrl),
  ]);
}
