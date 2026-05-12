const nodemailer = require("nodemailer");

const DEFAULT_FROM_EMAIL = "contact@yarddeck.in";
const DEFAULT_FROM_NAME = "Yard Deck";
const DEFAULT_TOURNAMENT_NAME = "The Yard Knockout";

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  };
}

function cleanText(value) {
  return String(value || "").trim();
}

function parseBoolean(rawValue, fallback = false) {
  const value = String(rawValue || "").trim().toLowerCase();
  if (!value) return fallback;
  if (["true", "1", "yes", "y"].includes(value)) return true;
  if (["false", "0", "no", "n"].includes(value)) return false;
  return fallback;
}

function maskEmail(email) {
  const value = cleanText(email).toLowerCase();
  const [localPart, domain] = value.split("@");
  if (!localPart || !domain) return value;
  const visible = localPart.slice(0, 2);
  return `${visible}***@${domain}`;
}

function buildTransportConfig() {
  const host = cleanText(process.env.SMTP_HOST || process.env.MAIL_HOST);
  const port = Number(process.env.SMTP_PORT || process.env.MAIL_PORT || 587);
  const secure = parseBoolean(
    process.env.SMTP_SECURE || process.env.MAIL_SECURE,
    port === 465
  );
  const user = cleanText(process.env.SMTP_USER || process.env.MAIL_USER);
  const pass = cleanText(process.env.SMTP_PASS || process.env.MAIL_PASS);

  if (!host || !Number.isFinite(port)) return null;

  return {
    host,
    port,
    secure,
    ...(user && pass ? { auth: { user, pass } } : {}),
  };
}

function buildMessageBody({ fullName, tournamentName }) {
  const greetingName = cleanText(fullName) || "there";
  const eventName = cleanText(tournamentName) || DEFAULT_TOURNAMENT_NAME;

  const text = [
    `Hi ${greetingName},`,
    "",
    `Thanks for joining the waitlist for ${eventName}.`,
    "You will be notified if registration opens again.",
    "",
    "Regards,",
    "Yard Deck Team",
    DEFAULT_FROM_EMAIL,
  ].join("\n");

  const html = `
    <p>Hi ${greetingName},</p>
    <p>Thanks for joining the waitlist for <strong>${eventName}</strong>.</p>
    <p>You will be notified if registration opens again.</p>
    <p>Regards,<br>Yard Deck Team<br>${DEFAULT_FROM_EMAIL}</p>
  `;

  return { text, html };
}

exports.handler = async (event) => {
  console.info("waitlist-email invocation", {
    method: event.httpMethod,
  });

  if (event.httpMethod !== "POST") {
    console.warn("waitlist-email rejected: invalid method", {
      method: event.httpMethod,
    });
    return json(405, { error: "Method not allowed." });
  }

  const transportConfig = buildTransportConfig();
  if (!transportConfig) {
    console.error("waitlist-email blocked: SMTP config missing", {
      hasSmtpHost: Boolean(process.env.SMTP_HOST || process.env.MAIL_HOST),
      hasSmtpPort: Boolean(process.env.SMTP_PORT || process.env.MAIL_PORT),
      hasSmtpUser: Boolean(process.env.SMTP_USER || process.env.MAIL_USER),
      hasSmtpPass: Boolean(process.env.SMTP_PASS || process.env.MAIL_PASS),
    });
    return json(500, {
      error:
        "SMTP is not configured. Set SMTP_* or MAIL_* environment variables.",
    });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (error) {
    console.error("waitlist-email rejected: invalid JSON body");
    return json(400, { error: "Invalid request body." });
  }

  const fullName = cleanText(payload.full_name);
  const email = cleanText(payload.email).toLowerCase();
  const tournamentName = cleanText(payload.tournament_name);

  if (!email) {
    console.warn("waitlist-email rejected: missing email");
    return json(400, { error: "Email is required." });
  }

  const fromEmail =
    cleanText(process.env.NOTIFY_FROM_EMAIL) ||
    cleanText(process.env.SMTP_FROM_EMAIL) ||
    cleanText(process.env.MAIL_FROM_EMAIL) ||
    DEFAULT_FROM_EMAIL;
  const fromName = cleanText(process.env.NOTIFY_FROM_NAME) || DEFAULT_FROM_NAME;
  const from = `${fromName} <${fromEmail}>`;
  const subject = `Waitlist confirmed - ${
    tournamentName || DEFAULT_TOURNAMENT_NAME
  }`;
  const { text, html } = buildMessageBody({ fullName, tournamentName });

  try {
    const transporter = nodemailer.createTransport(transportConfig);
    await transporter.sendMail({
      from,
      to: email,
      subject,
      text,
      html,
    });

    console.info("waitlist-email sent", {
      to: maskEmail(email),
      from,
      subject,
    });
    return json(200, { ok: true });
  } catch (error) {
    console.error("Waitlist confirmation email failed:", error);
    return json(502, { error: "Failed to send waitlist confirmation email." });
  }
};
