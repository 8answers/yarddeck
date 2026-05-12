const nodemailer = require("nodemailer");

const DEFAULT_FROM_EMAIL = "contact@yarddeck.in";
const DEFAULT_FROM_NAME = "Yard Deck";
const DEFAULT_TOURNAMENT_NAME = "The Yard Knockout";
const DEFAULT_SUPABASE = "https://hkdeqyyzuajjzjcmfgzx.supabase.co";
const DEFAULT_SITE_URL = "https://yarddeck.in";
const EMAIL_LOGO_PATH = "/assets/Email_logo.png";

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

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

function normalizeWaitlistEntryId(rawValue) {
  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function getSupabaseAdminConfig() {
  const url = cleanText(
    process.env.SUPABASE || process.env.SUPABASE_URL || DEFAULT_SUPABASE
  );
  const serviceRoleKey = cleanText(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!url || !serviceRoleKey) return null;
  return { url, serviceRoleKey };
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
  const cleanedFullName = cleanText(fullName);
  const greetingName = cleanedFullName ? cleanedFullName.split(/\s+/)[0] : "there";
  const eventName = cleanText(tournamentName) || DEFAULT_TOURNAMENT_NAME;
  const siteUrl = cleanText(process.env.SITE_URL || process.env.URL) || DEFAULT_SITE_URL;
  const normalizedSiteUrl = siteUrl.replace(/\/+$/, "");
  const logoUrl = `${normalizedSiteUrl}${EMAIL_LOGO_PATH}`;
  const safeGreetingName = escapeHtml(greetingName);
  const safeEventName = escapeHtml(eventName);

  const text = [
    `Hi ${greetingName},`,
    "",
    `Thank you for showing interest in ${eventName} by Yard Deck.`,
    "",
    "Your interest registration has been received successfully.",
    "",
    "Tournament registrations are not open yet. Once registrations officially open, we'll share:",
    "• Tournament date & schedule",
    "• Registration details",
    "• Match format & rules",
    "• Payment information",
    "• Important event updates",
    "",
    "We look forward to seeing you on the court.",
    "",
    "Team Yard Deck",
    DEFAULT_FROM_EMAIL,
    "yarddeck.in",
  ].join("\n");

  const html = `
    <div style="font-family: 'Nata Sans', Arial, sans-serif; color: #0f172a; line-height: 1.5;">
      <p style="margin: 0 0 16px;">Hi ${safeGreetingName},</p>
      <p style="margin: 0 0 16px;">Thank you for showing interest in <strong>${safeEventName}</strong> by Yard Deck.</p>
      <p style="margin: 0 0 16px;">Your interest registration has been received successfully.</p>
      <p style="margin: 0 0 8px;">Tournament registrations are not open yet. Once registrations officially open, we&rsquo;ll share:</p>
      <ul style="margin: 0 0 16px; padding-left: 20px;">
        <li>Tournament date &amp; schedule</li>
        <li>Registration details</li>
        <li>Match format &amp; rules</li>
        <li>Payment information</li>
        <li>Important event updates</li>
      </ul>
      <p style="margin: 0 0 16px;">We look forward to seeing you on the court.</p>
      <p style="margin: 0 0 4px;">Team Yard Deck</p>
      <p style="margin: 0 0 4px;"><a href="mailto:${DEFAULT_FROM_EMAIL}" style="color: inherit; text-decoration: none;">${DEFAULT_FROM_EMAIL}</a></p>
      <p style="margin: 0 0 16px;"><a href="https://yarddeck.in" style="color: inherit; text-decoration: none;">yarddeck.in</a></p>
      <img src="${logoUrl}" alt="Yard Deck icon" width="48" height="58" style="display:block; width:48px; height:58px;">
    </div>
  `;

  return { text, html };
}

async function updateWaitlistEmailStatus(waitlistEntryId, status, errorMessage = "") {
  if (!waitlistEntryId) return;

  const supabaseAdminConfig = getSupabaseAdminConfig();
  if (!supabaseAdminConfig) {
    console.warn("waitlist-email status update skipped: missing Supabase admin env");
    return;
  }

  const nowIso = new Date().toISOString();
  const payload = {
    confirmation_email_status: status,
    confirmation_email_attempted_at: nowIso,
    confirmation_email_sent_at: status === "sent" ? nowIso : null,
    confirmation_email_error:
      status === "failed"
        ? cleanText(errorMessage || "Email send failed").slice(0, 500)
        : null,
  };

  const response = await fetch(
    `${supabaseAdminConfig.url}/rest/v1/tournament_notify_emails?id=eq.${waitlistEntryId}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        apikey: supabaseAdminConfig.serviceRoleKey,
        Authorization: `Bearer ${supabaseAdminConfig.serviceRoleKey}`,
        Prefer: "return=minimal",
      },
      body: JSON.stringify(payload),
    }
  );

  if (!response.ok) {
    const responseText = await response.text().catch(() => "");
    console.error("waitlist-email status update failed", {
      waitlistEntryId,
      status,
      responseStatus: response.status,
      responseText,
    });
  }
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
  const waitlistEntryId = normalizeWaitlistEntryId(payload.waitlist_entry_id);

  const transportConfig = buildTransportConfig();
  if (!transportConfig) {
    console.error("waitlist-email blocked: SMTP config missing", {
      hasSmtpHost: Boolean(process.env.SMTP_HOST || process.env.MAIL_HOST),
      hasSmtpPort: Boolean(process.env.SMTP_PORT || process.env.MAIL_PORT),
      hasSmtpUser: Boolean(process.env.SMTP_USER || process.env.MAIL_USER),
      hasSmtpPass: Boolean(process.env.SMTP_PASS || process.env.MAIL_PASS),
    });
    await updateWaitlistEmailStatus(
      waitlistEntryId,
      "failed",
      "SMTP is not configured"
    );
    return json(500, {
      error:
        "SMTP is not configured. Set SMTP_* or MAIL_* environment variables.",
    });
  }

  if (!email) {
    console.warn("waitlist-email rejected: missing email");
    await updateWaitlistEmailStatus(waitlistEntryId, "failed", "Email is required");
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
    await updateWaitlistEmailStatus(waitlistEntryId, "sent");
    return json(200, { ok: true });
  } catch (error) {
    console.error("Waitlist confirmation email failed:", error);
    await updateWaitlistEmailStatus(
      waitlistEntryId,
      "failed",
      error?.message || "Email send failed"
    );
    return json(502, { error: "Failed to send waitlist confirmation email." });
  }
};
