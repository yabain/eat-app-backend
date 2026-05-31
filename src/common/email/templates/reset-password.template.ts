import { MailTemplate, renderMailLayout } from '../mail-layout';

export function resetPasswordTemplate(input: { resetLink: string; expiresIn?: string }): MailTemplate {
  return {
    subject: 'Réinitialisation de votre mot de passe',
    html: renderMailLayout({
      preview: 'Utilisez ce lien pour réinitialiser votre mot de passe Eat App.',
      eyebrow: 'Sécurité',
      title: 'Réinitialiser votre mot de passe',
      intro: 'Vous avez demandé la réinitialisation de votre mot de passe Eat App.',
      body: `Le lien ci-dessous est valable ${input.expiresIn || '1 heure'}.`,
      cta: { label: 'Réinitialiser mon mot de passe', url: input.resetLink },
      note: "Si vous n'êtes pas à l'origine de cette demande, ignorez simplement cet email.",
    }),
  };
}
