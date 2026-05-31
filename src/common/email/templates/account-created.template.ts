import { MailTemplate, renderMailLayout } from '../mail-layout';

export function accountCreatedTemplate(input: { firstName?: string; loginUrl?: string }): MailTemplate {
  return {
    subject: 'Bienvenue sur Eat App',
    html: renderMailLayout({
      preview: 'Votre compte Eat App a été créé avec succès.',
      eyebrow: 'Bienvenue',
      title: 'Votre compte est prêt',
      intro: `Bonjour ${input.firstName || 'et bienvenue'}, votre compte Eat App a été créé avec succès.`,
      body: 'Vous pouvez maintenant commander vos repas, suivre vos commandes et gérer votre profil depuis votre espace client.',
      cta: input.loginUrl ? { label: 'Ouvrir Eat App', url: input.loginUrl } : undefined,
    }),
  };
}
