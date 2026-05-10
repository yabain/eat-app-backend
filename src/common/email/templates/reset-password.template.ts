import { MailTemplate, renderMailLayout } from '../mail-layout';

export function resetPasswordTemplate(input: { resetLink: string; expiresIn?: string }): MailTemplate {
  return {
    subject: 'Reinitialisation de votre mot de passe',
    html: renderMailLayout({
      preview: 'Utilisez ce lien pour reinitialiser votre mot de passe Eat App.',
      eyebrow: 'Securite',
      title: 'Reinitialiser votre mot de passe',
      intro: 'Vous avez demande la reinitialisation de votre mot de passe Eat App.',
      body: `Le lien ci-dessous est valable ${input.expiresIn || '1 heure'}.`,
      cta: { label: 'Reinitialiser mon mot de passe', url: input.resetLink },
      note: "Si vous n'etes pas a l'origine de cette demande, ignorez simplement cet email.",
    }),
  };
}
