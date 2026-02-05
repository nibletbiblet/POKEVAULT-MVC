const nodemailer = require('nodemailer');

let cachedTransporter = null;

function getTransporter() {
  if (cachedTransporter) return cachedTransporter;
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const secure = String(process.env.SMTP_SECURE || '').toLowerCase() === 'true';

  if (!host || !user || !pass) {
    throw new Error('SMTP credentials are not configured.');
  }

  cachedTransporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass }
  });
  return cachedTransporter;
}

async function sendMail({ to, subject, text, html }) {
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  const transporter = getTransporter();
  return transporter.sendMail({
    from,
    to,
    subject,
    text,
    html
  });
}

module.exports = {
  sendMail
};
