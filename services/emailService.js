// ═══════════════════════════════════════════════════════════
// services/emailService.js — Nakama | Nodemailer
// ═══════════════════════════════════════════════════════════

const nodemailer = require("nodemailer");
require("dotenv").config();

const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;

let _transport = null;

async function getTransport() {
  if (_transport) return _transport;
  _transport = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: EMAIL_USER,
      pass:EMAIL_PASS,
    },
  });
  await _transport.verify();
  console.log("📬  [email] Gmail listo para enviar.");
  return _transport;
}

// ─── Template: verificación de cuenta ────────────────────
function verificationEmailHTML(code, username) {
  return `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Verificá tu cuenta — Nakama</title>
  <style>
    body { margin:0; padding:0; background:#050508; font-family:Arial,sans-serif; color:#e8e8f0; }
    .wrapper { max-width:520px; margin:0 auto; padding:40px 20px; }
    .card { background:#0e0e1a; border:1px solid rgba(76,201,240,0.15); border-radius:16px; padding:40px 36px; text-align:center; }
    .logo { font-size:1.2rem; font-weight:900; letter-spacing:0.2em; color:#e63946; margin-bottom:24px; display:block; }
    h1 { font-size:1.5rem; font-weight:700; margin-bottom:8px; color:#e8e8f0; }
    .subtitle { color:#7a7a9a; font-size:0.95rem; margin-bottom:32px; line-height:1.6; }
    .code-box { display:inline-flex; gap:8px; background:#050508; border:2px solid rgba(230,57,70,0.4); border-radius:12px; padding:18px 28px; margin-bottom:28px; box-shadow:0 0 30px rgba(230,57,70,0.15); }
    .code-digit { font-family:monospace; font-size:2.2rem; font-weight:900; color:#e63946; min-width:36px; text-align:center; }
    .warning { background:rgba(255,209,102,0.08); border:1px solid rgba(255,209,102,0.2); border-radius:8px; padding:12px 16px; font-size:0.82rem; color:#ffd166; margin-bottom:24px; }
    .footer { font-size:0.75rem; color:#4a4a6a; margin-top:24px; line-height:1.6; }
    .divider { height:1px; background:rgba(76,201,240,0.1); margin:24px 0; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="card">
      <span class="logo">⚔ NAKAMA</span>
      <h1>Verificá tu cuenta, ${username}</h1>
      <p class="subtitle">
        Usá este código para confirmar tu email y activar tu cuenta Nakama.<br/>
        <strong>Expira en 15 minutos.</strong>
      </p>
      <div class="code-box">
        <span class="code-digit">${code.split("").join('</span><span class="code-digit">')}</span>
      </div>
      <div class="warning">
        ⚠ Este código es de un solo uso. No lo compartas con nadie.<br/>
        Si no creaste esta cuenta, ignorá este email.
      </div>
      <div class="divider"></div>
      <p class="footer">
        Este email fue enviado porque alguien intentó registrarse con esta dirección en Nakama.<br/>
        Si no fuiste vos, no hace falta que hagas nada.
      </p>
    </div>
  </div>
</body>
</html>`;
}

// ─── Template: reset de contraseña ───────────────────────
function resetPasswordEmailHTML(username, resetUrl) {
  return `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Recuperá tu contraseña — Nakama</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { background:#06060f; font-family:'Segoe UI', Arial, sans-serif; color:#e2e2f0; }
    .wrapper { max-width:540px; margin:0 auto; padding:48px 20px; }

    /* Card principal */
    .card {
      background: linear-gradient(160deg, #0d0d1f 0%, #0a0a18 100%);
      border: 1px solid rgba(230,57,70,0.18);
      border-radius: 20px;
      overflow: hidden;
      box-shadow: 0 0 60px rgba(230,57,70,0.08), 0 20px 40px rgba(0,0,0,0.5);
    }

    /* Header con imagen + overlay */
    .card-header {
      position: relative;
      padding: 36px 36px 28px;
      background: linear-gradient(135deg, #12021e 0%, #1a0210 50%, #0d0d1f 100%);
      border-bottom: 1px solid rgba(230,57,70,0.12);
      text-align: center;
    }
    .card-header::before {
      content: '';
      position: absolute;
      inset: 0;
      background: radial-gradient(ellipse at 50% 0%, rgba(230,57,70,0.15) 0%, transparent 70%);
    }
    .logo-row {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      margin-bottom: 20px;
    }
    .logo-img {
      width: 44px;
      height: 44px;
      border-radius: 10px;
      border: 2px solid rgba(230,57,70,0.4);
      object-fit: cover;
    }
    .logo-text {
      font-size: 1.3rem;
      font-weight: 900;
      letter-spacing: 0.25em;
      color: #e63946;
      text-shadow: 0 0 20px rgba(230,57,70,0.5);
    }
    .header-icon {
      position: relative;
      font-size: 2.8rem;
      margin-bottom: 12px;
      display: block;
      filter: drop-shadow(0 0 12px rgba(230,57,70,0.6));
    }
    .header-title {
      position: relative;
      font-size: 1.45rem;
      font-weight: 800;
      color: #f0f0fa;
      margin-bottom: 6px;
    }
    .header-subtitle {
      position: relative;
      font-size: 0.9rem;
      color: #6b6b8e;
      line-height: 1.5;
    }
    .header-subtitle strong { color: #a0a0c0; }

    /* Body */
    .card-body { padding: 36px; }
    .greeting {
      font-size: 0.95rem;
      color: #9090b8;
      margin-bottom: 24px;
      line-height: 1.7;
    }
    .greeting strong { color: #e2e2f0; }

    /* Botón CTA */
    .cta-wrap { text-align: center; margin: 28px 0; }
    .cta-btn {
      display: inline-block;
      padding: 14px 44px;
      background: linear-gradient(135deg, #e63946, #c1121f);
      color: #fff !important;
      text-decoration: none;
      font-size: 0.95rem;
      font-weight: 700;
      letter-spacing: 0.05em;
      border-radius: 12px;
      box-shadow: 0 4px 20px rgba(230,57,70,0.4), 0 0 0 1px rgba(230,57,70,0.3);
      transition: all 0.2s;
    }

    /* URL de respaldo */
    .fallback-box {
      background: rgba(255,255,255,0.03);
      border: 1px solid rgba(255,255,255,0.06);
      border-radius: 10px;
      padding: 14px 18px;
      margin: 20px 0;
    }
    .fallback-label {
      font-size: 0.75rem;
      color: #55557a;
      margin-bottom: 6px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    .fallback-url {
      font-size: 0.78rem;
      color: #4cc9f0;
      word-break: break-all;
      line-height: 1.5;
    }

    /* Warning */
    .warning-box {
      display: flex;
      gap: 12px;
      align-items: flex-start;
      background: rgba(255,209,102,0.06);
      border: 1px solid rgba(255,209,102,0.15);
      border-radius: 10px;
      padding: 14px 16px;
      margin: 24px 0 0;
    }
    .warning-icon { font-size: 1.1rem; flex-shrink: 0; margin-top: 1px; }
    .warning-text { font-size: 0.82rem; color: #c9a227; line-height: 1.6; }

    /* Footer */
    .card-footer {
      padding: 20px 36px;
      border-top: 1px solid rgba(255,255,255,0.04);
      background: rgba(0,0,0,0.2);
    }
    .footer-text {
      font-size: 0.75rem;
      color: #3a3a58;
      text-align: center;
      line-height: 1.7;
    }
    .footer-kanji {
      display: block;
      font-size: 1.1rem;
      color: rgba(230,57,70,0.2);
      margin-top: 8px;
      text-align: center;
    }
    .divider { height: 1px; background: rgba(76,201,240,0.07); margin: 20px 0; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="card">

      <!-- Header -->
      <div class="card-header">
        <div class="logo-row">
          <img
            src="https://res.cloudinary.com/nakama/image/upload/nakama-logo.jpg"
            alt="Nakama"
            class="logo-img"
            onerror="this.style.display='none'"
          />
          <span class="logo-text">NAKAMA</span>
        </div>
        <span class="header-icon">🔑</span>
        <h1 class="header-title">Recuperá tu contraseña</h1>
        <p class="header-subtitle">
          Recibimos una solicitud para restablecer<br/>
          la contraseña de tu cuenta Nakama.
        </p>
      </div>

      <!-- Body -->
      <div class="card-body">
        <p class="greeting">
          Hola, <strong>${username}</strong> 👋<br/><br/>
          Hacé clic en el botón de abajo para crear una nueva contraseña.
          Este enlace es válido durante <strong>1 hora</strong> y es de un solo uso.
        </p>

        <div class="cta-wrap">
          <a href="${resetUrl}" class="cta-btn">
            Restablecer contraseña
          </a>
        </div>

        <div class="fallback-box">
          <p class="fallback-label">¿El botón no funciona? Copiá este enlace:</p>
          <span class="fallback-url">${resetUrl}</span>
        </div>

        <div class="warning-box">
          <span class="warning-icon">⚠️</span>
          <p class="warning-text">
            Si no solicitaste este cambio, ignorá este email — tu contraseña seguirá siendo la misma.
            Nadie de Nakama te pedirá tu contraseña por email.
          </p>
        </div>
      </div>

      <!-- Footer -->
      <div class="card-footer">
        <p class="footer-text">
          Este mensaje fue enviado a <strong>${username}</strong> desde Nakama.<br/>
          © ${new Date().getFullYear()} Nakama — Anime · Gamer · Cultura Geek
        </p>
        <span class="footer-kanji">仲間</span>
      </div>

    </div>
  </div>
</body>
</html>`;
}

// ═══════════════════════════════════════════════════════════
// sendVerificationEmail
// ═══════════════════════════════════════════════════════════
async function sendVerificationEmail(to, username, code) {
  const transport = await getTransport();
  const info = await transport.sendMail({
    from:    '"Nakama 🎌" <gjoaquinreynoso@gmail.com>',
    to,
    subject: `${code} — Verificá tu cuenta de Nakama`,
    text:    `Hola ${username}! Tu código de verificación es: ${code}. Expira en 15 minutos.`,
    html:    verificationEmailHTML(code, username),
  });
  console.log(`📬  [email] Verificación enviada a ${to} | ${info.messageId}`);
  return info;
}

// ═══════════════════════════════════════════════════════════
// sendResetPasswordEmail
// ═══════════════════════════════════════════════════════════
async function sendResetPasswordEmail(to, username, resetUrl) {
  const transport = await getTransport();
  const info = await transport.sendMail({
    from:    '"Nakama 🎌" <system.nakama@gmail.com>',
    to,
    subject: `Restablecé tu contraseña de Nakama`,
    text:    `Hola ${username}! Para restablecer tu contraseña visitá: ${resetUrl} — Expira en 1 hora.`,
    html:    resetPasswordEmailHTML(username, resetUrl),
  });
  console.log(`📬  [email] Reset enviado a ${to} | ${info.messageId}`);
  return info;
}

module.exports = { sendVerificationEmail, sendResetPasswordEmail };