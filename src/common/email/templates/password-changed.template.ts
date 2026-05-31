import { MailTemplate, renderMailLayout } from '../mail-layout';

export function passwordChangedTemplate(input: { firstName?: string; loginUrl?: string }): MailTemplate {
  return {
    subject: 'Votre mot de passe a été modifié',
    html: renderMailLayout({
      preview: 'Votre mot de passe Eat App vient d’être modifié.',
      eyebrow: 'Sécurité',
      title: 'Mot de passe modifié',
      intro: `Bonjour ${input.firstName || ''}, votre mot de passe a été modifié avec succès.`.trim(),
      body: "Si cette action ne vient pas de vous, contactez rapidement l'équipe Eat App.",
      cta: input.loginUrl ? { label: 'Se connecter', url: input.loginUrl } : undefined,
    }),
  };
}
