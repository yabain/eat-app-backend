import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const PRIMARY_COLOR = '#e05b03';
const LOGO_URL = 'https://eat.yaba-in.com/assets/images/logo_eat_app.png';

export type MailTemplate = {
  subject: string;
  html: string;
};

export type MailDetail = {
  label: string;
  value?: string | number | null;
};

export type MailCta = {
  label: string;
  url: string;
};

export type MailLayoutInput = {
  preview: string;
  eyebrow: string;
  title: string;
  intro: string;
  body?: string;
  cta?: MailCta;
  details?: MailDetail[];
  note?: string;
};

function escapeHtml(value?: string | number | null) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getFooterHtml() {
  const footerPath = join(process.cwd(), 'src', 'email-sign.html');
  if (!existsSync(footerPath)) return '';
  return readFileSync(footerPath, 'utf8');
}

function renderDetails(details?: MailDetail[]) {
  const rows = (details || []).filter((detail) => detail.value !== undefined && detail.value !== null && detail.value !== '');
  if (rows.length === 0) return '';

  return `
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin: 24px 0; border-collapse: collapse;">
      ${rows
        .map(
          (detail) => `
            <tr>
              <td style="padding: 12px 0; border-bottom: 1px solid #f1f1f1; color: #6b7280; font-size: 14px;">${escapeHtml(detail.label)}</td>
              <td align="right" style="padding: 12px 0; border-bottom: 1px solid #f1f1f1; color: #111827; font-size: 14px; font-weight: 600;">${escapeHtml(detail.value)}</td>
            </tr>
          `,
        )
        .join('')}
    </table>
  `;
}

function renderCta(cta?: MailCta) {
  if (!cta) return '';
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin: 28px 0;">
      <tr>
        <td bgcolor="${PRIMARY_COLOR}" style="border-radius: 8px;">
          <a href="${escapeHtml(cta.url)}" style="display: inline-block; padding: 14px 22px; color: #ffffff; font-size: 14px; font-weight: 700; text-decoration: none;">
            ${escapeHtml(cta.label)}
          </a>
        </td>
      </tr>
    </table>
  `;
}

export function renderMailLayout(input: MailLayoutInput) {
  return `
<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(input.title)}</title>
  </head>
  <body style="margin: 0; padding: 0; background: #f6f7f9; font-family: Arial, Helvetica, sans-serif; color: #111827;">
    <div style="display: none; max-height: 0; overflow: hidden; opacity: 0;">${escapeHtml(input.preview)}</div>
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background: #f6f7f9; padding: 28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width: 640px; background: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #eceff3;">
            <tr>
              <td style="padding: 28px 32px 20px; border-top: 5px solid ${PRIMARY_COLOR};">
                <img src="${LOGO_URL}" alt="Eat App" width="112" style="display: block; max-width: 112px; margin-bottom: 24px;">
                <p style="margin: 0 0 10px; color: ${PRIMARY_COLOR}; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em;">${escapeHtml(input.eyebrow)}</p>
                <h1 style="margin: 0; color: #111827; font-size: 26px; line-height: 1.25; font-weight: 700;">${escapeHtml(input.title)}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding: 0 32px 28px;">
                <p style="margin: 0 0 16px; color: #374151; font-size: 16px; line-height: 1.65;">${escapeHtml(input.intro)}</p>
                ${input.body ? `<p style="margin: 0 0 18px; color: #4b5563; font-size: 15px; line-height: 1.65;">${escapeHtml(input.body)}</p>` : ''}
                ${renderDetails(input.details)}
                ${renderCta(input.cta)}
                ${input.note ? `<div style="margin-top: 22px; padding: 14px 16px; border-radius: 8px; background: #fff7ed; color: #7c2d12; font-size: 13px; line-height: 1.6;">${escapeHtml(input.note)}</div>` : ''}
              </td>
            </tr>
            <tr>
              <td style="padding: 0 32px 30px;">
                <div style="height: 1px; background: #eceff3; margin-bottom: 22px;"></div>
                ${getFooterHtml()}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
  `;
}
