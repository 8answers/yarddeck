const CASHFREE_API_VERSION = "2023-08-01";
const CASHFREE_SANDBOX_ORDERS_URL = "https://sandbox.cashfree.com/pg/orders";
const CASHFREE_PRODUCTION_ORDERS_URL = "https://api.cashfree.com/pg/orders";
const TOURNAMENT_SLUG = "the_yard_knockout";
const TOURNAMENT_AMOUNT = 399;

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

function buildOrderId() {
  return `yarddeck_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed." });
  }

  const appId = process.env.CASHFREE_APP_ID;
  const secretKey = process.env.CASHFREE_SECRET_KEY;
  const cashfreeEnv = cleanText(process.env.CASHFREE_ENV || "sandbox").toLowerCase();

  if (!appId || !secretKey) {
    return json(500, { error: "Cashfree credentials are not configured." });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (error) {
    return json(400, { error: "Invalid request body." });
  }

  const fullName = cleanText(payload.full_name);
  const email = cleanText(payload.email).toLowerCase();
  const phoneNumber = cleanText(payload.phone_number).replace(/\D/g, "");

  if (!fullName || !email || !phoneNumber) {
    return json(400, { error: "Name, email, and phone number are required." });
  }

  if (payload.tournament_slug !== TOURNAMENT_SLUG) {
    return json(400, { error: "Invalid tournament." });
  }

  const orderId = buildOrderId();
  const origin =
    event.headers.origin ||
    event.headers.referer?.replace(/\/[^/]*$/, "") ||
    "http://localhost:8000";
  const returnUrl = `${origin}/registration_success/?order_id={order_id}`;
  const notifyUrl = process.env.CASHFREE_NOTIFY_URL;

  const cashfreePayload = {
    order_id: orderId,
    order_amount: TOURNAMENT_AMOUNT,
    order_currency: "INR",
    customer_details: {
      customer_id: email,
      customer_name: fullName,
      customer_email: email,
      customer_phone: phoneNumber,
    },
    order_meta: {
      return_url: returnUrl,
      ...(notifyUrl ? { notify_url: notifyUrl } : {}),
    },
    order_note: "The Yard Knockout registration",
  };

  const ordersUrl =
    cashfreeEnv === "production"
      ? CASHFREE_PRODUCTION_ORDERS_URL
      : CASHFREE_SANDBOX_ORDERS_URL;

  try {
    const cashfreeResponse = await fetch(ordersUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-version": CASHFREE_API_VERSION,
        "x-client-id": appId,
        "x-client-secret": secretKey,
      },
      body: JSON.stringify(cashfreePayload),
    });

    const cashfreeBody = await cashfreeResponse.json().catch(() => ({}));

    if (!cashfreeResponse.ok) {
      console.error("Cashfree order creation failed:", cashfreeBody);
      return json(cashfreeResponse.status, {
        error: cashfreeBody.message || "Cashfree order creation failed.",
      });
    }

    return json(200, {
      orderId: cashfreeBody.order_id,
      paymentSessionId: cashfreeBody.payment_session_id,
    });
  } catch (error) {
    console.error("Cashfree order request failed:", error);
    return json(502, { error: "Unable to reach Cashfree." });
  }
};
