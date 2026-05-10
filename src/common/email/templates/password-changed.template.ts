import { MailTemplate, renderMailLayout } from '../mail-layout';

export function passwordChangedTemplate(input: { firstName?: string; loginUrl?: string }): MailTemplate {
  return {
    subject: 'Votre mot de passe a ete modifie',
    html: renderMailLayout({
      preview: 'Votre mot de passe Eat App vient d’etre modifie.',
      eyebrow: 'Securite',
      title: 'Mot de passe modifie',
      intro: `Bonjour ${input.firstName || ''}, votre mot de passe a ete modifie avec succes.`.trim(),
      body: "Si cette action ne vient pas de vous, contactez rapidement l'equipe Eat App.",
      cta: input.loginUrl ? { label: 'Se connecter', url: input.loginUrl } : undefined,
    }),
  };
}
