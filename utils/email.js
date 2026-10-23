const nodemailer = require('nodemailer');

function getTransporter() {
  if (!process.env.SMTP_USER || process.env.SMTP_USER === 'your-email@gmail.com') {
    console.log('SMTP not configured - receipt email will be logged only');
    return null;
  }
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT || 587),
    secure: false,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
}

async function sendDonationEmail(donation) {
  const transporter = getTransporter();
  if (!transporter) {
    console.log(`[EMAIL LOG] Would send receipt to ${donation.DONOR_EMAIL}: ${donation.CURRENCY} ${donation.AMOUNT} (Ben ${donation.BENEFICIARY_AMOUNT} + Fee ${donation.PLATFORM_FEE})`);
    return false;
  }
  if (!donation.DONOR_EMAIL) return false;

  const coverText = donation.COVER_FEE ? 
    `You chose to cover the platform fee, so the campaign receives the full UGX ${donation.BENEFICIARY_AMOUNT}.` :
    `Platform fee 10%: UGX ${donation.PLATFORM_FEE} - Campaign receives UGX ${donation.BENEFICIARY_AMOUNT}.`;

  const html = `
  <div style="font-family:Arial; max-width:600px; margin:auto; border:1px solid #eee; padding:20px; border-radius:12px">
    <h2 style="color:#0a7f3e">Ask Kin - Thank you!</h2>
    <p>Hi ${donation.DONOR_NAME || 'Donor'},</p>
    <p>Your donation was successful 🎉</p>
    <table style="width:100%; border-collapse:collapse; margin:15px 0">
      <tr><td style="padding:8px; border-bottom:1px solid #eee">Donation ID</td><td style="padding:8px; border-bottom:1px solid #eee"><b>${donation.ID}</b></td></tr>
      <tr><td style="padding:8px; border-bottom:1px solid #eee">Amount Charged</td><td style="padding:8px; border-bottom:1px solid #eee"><b>${donation.CURRENCY} ${Number(donation.AMOUNT).toLocaleString()}</b></td></tr>
      <tr><td style="padding:8px; border-bottom:1px solid #eee">Campaign Receives</td><td style="padding:8px; border-bottom:1px solid #eee; color:#0a7f3e"><b>${donation.CURRENCY} ${Number(donation.BENEFICIARY_AMOUNT).toLocaleString()}</b></td></tr>
      <tr><td style="padding:8px; border-bottom:1px solid #eee">Platform Fee (10%)</td><td style="padding:8px; border-bottom:1px solid #eee">${donation.CURRENCY} ${Number(donation.PLATFORM_FEE).toLocaleString()}</td></tr>
      <tr><td style="padding:8px;">Cover Fee</td><td style="padding:8px;">${donation.COVER_FEE ? 'Yes - you covered it' : 'No'}</td></tr>
    </table>
    <p style="font-size:13px; color:#666">${coverText}</p>
    <p style="font-size:13px; color:#666">Tracking: ${donation.PESAPAL_TRACKING_ID || donation.ORDER_TRACKING_ID}</p>
    <hr/>
    <p style="font-size:12px; color:#999">Ask Kin • Kampala, Uganda • This is an automated receipt.</p>
  </div>`;

  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: donation.DONOR_EMAIL,
    subject: `Receipt: You donated ${donation.CURRENCY} ${donation.AMOUNT} - Ask Kin`,
    html
  });
  console.log('✅ Receipt email sent to', donation.DONOR_EMAIL);
  return true;
}

async function sendEmail(to, subject, textOrHtml) {
  const transporter = getTransporter();
  if (!transporter) return false;
  const isHtml = textOrHtml.includes('<');
  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to, subject,
    ...(isHtml ? { html: textOrHtml } : { text: textOrHtml })
  });
  return true;
}

module.exports = { sendDonationEmail, sendEmail };