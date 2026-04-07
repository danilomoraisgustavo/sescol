// backend/utils/mailer.js
import nodemailer from 'nodemailer';

function getTransporter() {
  const mode = String(process.env.MAIL_TRANSPORT || 'smtp').toLowerCase();

  if (mode === 'gmail') {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
    const user = process.env.GMAIL_SENDER;

    if (!clientId || !clientSecret || !refreshToken || !user) {
      throw new Error('Config Gmail incompleta. Defina: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN, GMAIL_SENDER.');
    }

    return nodemailer.createTransport({
      service: 'gmail',
      auth: { type: 'OAuth2', user, clientId, clientSecret, refreshToken }
    });
  }

  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true';
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    throw new Error('Config SMTP incompleta. Defina: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS (e opcional SMTP_SECURE).');
  }

  return nodemailer.createTransport({ host, port, secure, auth: { user, pass } });
}

function escapeHtml(s) {
  return String(s || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function buildPremiumResetEmailHtml({ appName, logoUrl, code, expiresMinutes, appUrl, supportText }) {
  const safeApp = escapeHtml(appName);
  const safeLogo = escapeHtml(logoUrl);
  const safeCode = escapeHtml(code);
  const safeSupport = escapeHtml(supportText || '');
  const safeUrl = escapeHtml(appUrl || '');

  const preheader = `Seu código de redefinição: ${code} (expira em ${expiresMinutes} min)`;

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width">
  <meta name="x-apple-disable-message-reformatting">
  <title>Redefinição de Senha</title>
  <style>
    @media (max-width: 520px) {
      .container { padding: 18px !important; }
      .card { padding: 18px !important; }
      .code { font-size: 28px !important; letter-spacing: 6px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#f5f7fb;font-family:Arial,Helvetica,sans-serif;color:#1f2a37;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(preheader)}</div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f7fb;padding:28px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:92%;">
          <tr>
            <td class="container" style="padding:22px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="left" style="padding:0 0 14px;">
                    <img src="${safeLogo}" alt="${safeApp}" style="height:34px;display:block;">
                  </td>
                </tr>

                <tr>
                  <td class="card" style="background:#ffffff;border-radius:16px;padding:26px;border:1px solid #e6eaf2;box-shadow:0 10px 28px rgba(24,39,75,0.06);">
                    <div style="font-size:18px;font-weight:700;line-height:1.3;margin:0 0 8px;">
                      Redefinição de senha
                    </div>

                    <div style="font-size:14px;line-height:1.6;opacity:0.9;margin:0 0 18px;">
                      Use o código abaixo para redefinir sua senha no <strong>${safeApp}</strong>.
                      Este código expira em <strong>${escapeHtml(expiresMinutes)}</strong> minutos.
                    </div>

                    <div style="text-align:center;margin:18px 0 18px;">
                      <div class="code" style="display:inline-block;background:#0b1220;color:#ffffff;border-radius:14px;padding:14px 18px;font-size:34px;font-weight:800;letter-spacing:8px;">
                        ${safeCode}
                      </div>
                    </div>

                    ${safeUrl ? `
                    <div style="text-align:center;margin:8px 0 18px;">
                      <a href="${safeUrl}" style="display:inline-block;background:#4d84ff;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:999px;font-weight:700;font-size:14px;">
                        Abrir o sistema
                      </a>
                    </div>` : ''}

                    <div style="font-size:13px;line-height:1.6;color:#4b5563;margin:0;">
                      ${safeSupport}
                    </div>

                    <div style="margin-top:16px;padding-top:16px;border-top:1px dashed #e6eaf2;font-size:12px;line-height:1.6;color:#6b7280;">
                      Se você não solicitou esta redefinição, recomendamos trocar sua senha assim que possível e revisar acessos.
                    </div>
                  </td>
                </tr>

                <tr>
                  <td style="padding:14px 4px 0;font-size:12px;line-height:1.6;color:#6b7280;text-align:center;">
                    © ${new Date().getFullYear()} ${safeApp}. Todos os direitos reservados.
                  </td>
                </tr>

              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export async function sendPasswordResetEmail({ to, code, expiresMinutes, appName, appUrl, logoUrl, supportText }) {
  const transporter = getTransporter();
  const from = process.env.MAIL_FROM || `${appName} <no-reply@pydentech.com>`;
  const subject = process.env.MAIL_RESET_SUBJECT || `${appName} • Código de redefinição de senha`;
  const html = buildPremiumResetEmailHtml({ appName, logoUrl, code, expiresMinutes, appUrl, supportText });

  await transporter.sendMail({ from, to, subject, html });
}
