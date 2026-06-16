const nodemailer = require('nodemailer');

let _transporter = null;

function getTransporter() {
  if (_transporter) return _transporter;
  _transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.EMAIL_PORT) || 587,
    secure: process.env.EMAIL_SECURE === 'true',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });
  return _transporter;
}

async function sendVerificationCode(email, code) {
  const from = process.env.EMAIL_FROM || '"FixRadar" <noreply@fixradar.com>';
  await getTransporter().sendMail({
    from,
    to: email,
    subject: `${code} es tu código de verificación - FixRadar`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;">
        <div style="background:#FF8A00;padding:24px;text-align:center;border-radius:10px 10px 0 0;">
          <h1 style="color:#fff;margin:0;font-size:28px;">FixRadar</h1>
        </div>
        <div style="padding:32px;background:#fafafa;border-radius:0 0 10px 10px;">
          <h2 style="color:#222;margin-top:0;">Verificación de correo</h2>
          <p style="color:#555;">Usa este código para completar tu registro:</p>
          <div style="background:#fff;border:2px solid #FF8A00;border-radius:10px;
                      padding:24px;text-align:center;margin:20px 0;">
            <span style="font-size:40px;font-weight:bold;letter-spacing:10px;
                         color:#FF8A00;">${code}</span>
          </div>
          <p style="color:#999;font-size:13px;margin-bottom:0;">
            Este código expira en <strong>10 minutos</strong>.<br>
            Si no solicitaste esto, ignora este mensaje.
          </p>
        </div>
      </div>
    `,
  });
}

module.exports = { sendVerificationCode };
