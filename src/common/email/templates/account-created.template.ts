import { MailTemplate, renderMailLayout } from '../mail-layout';

export function accountCreatedTemplate(input: { firstName?: string; loginUrl?: string }): MailTemplate {
  return {
    subject: 'Bienvenue sur Eat App',
    html: renderMailLayout({
      preview: 'Votre compte Eat App a ete cree avec succes.',
      eyebrow: 'Bienvenue',
      title: 'Votre compte est pret',
      intro: `Bonjour ${input.firstName || 'et bienvenue'}, votre compte Eat App a ete cree avec succes.`,
      body: 'Vous pouvez maintenant commander vos repas, suivre vos commandes et gerer votre profil depuis votre espace client.',
      cta: input.loginUrl ? { label: 'Ouvrir Eat App', url: input.loginUrl } : undefined,
    }),
  };
}
