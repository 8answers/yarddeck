const form = document.querySelector(".registration-form");
const paymentButton = document.querySelector(".payment-button");
const formStatus = document.querySelector("[data-form-status]");
const SUPABASE_URL = "https://hkdeqyyzuajjzjcmfgzx.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable__EFfpHtvXJR3zGb5KWs6eg_-j1F6fEf";
const SUPABASE_CDN_URL = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
const REGISTRATIONS_TABLE = "tournament_registrations";
const WAITLIST_TABLE = "tournament_waitlist";
const TOURNAMENT_NAME = "The Yard Knockout";
const TOURNAMENT_SLUG = "the_yard_knockout";
const LAST_REGISTRATION_EMAIL_KEY = "yarddeck_last_registration_email";
const TEST_REGISTRATION_LIMIT = 32;
const REGISTRATION_COUNT_RPC = "get_tournament_registration_count";
const REGISTRATION_AVAILABILITY_RPC = "check_tournament_registration_availability";
const CASHFREE_ORDER_FUNCTION_URL = "/.netlify/functions/create-cashfree-order";
const CASHFREE_MODE = "sandbox";

const FORM_MODE = String(form?.dataset.mode || "registration").toLowerCase();
const SUCCESS_REDIRECT_BY_MODE = {
  registration: "/registration_success/",
  waitlist: "/waitlist_confirmed/",
};
const TABLE_BY_MODE = {
  registration: REGISTRATIONS_TABLE,
  waitlist: WAITLIST_TABLE,
};

let isSubmitting = false;
let supabaseClientPromise = null;

function normalizeEmailForMatch(rawEmail) {
  const email = String(rawEmail || "").trim().toLowerCase();
  if (!email.includes("@")) return email;

  const [localPartRaw, domainRaw] = email.split("@");
  const localPart = String(localPartRaw || "");
  const domain = String(domainRaw || "");

  if (domain === "gmail.com" || domain === "googlemail.com") {
    const localWithoutPlus = localPart.split("+")[0];
    const localWithoutDots = localWithoutPlus.replace(/\./g, "");
    return `${localWithoutDots}@gmail.com`;
  }

  return `${localPart}@${domain}`;
}

function coerceCountValue(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (value && typeof value === "object") {
    if (typeof value.count !== "undefined") return coerceCountValue(value.count);
    if (typeof value.registration_count !== "undefined") {
      return coerceCountValue(value.registration_count);
    }
  }
  return 0;
}

function updatePaymentState() {
  if (!form || !paymentButton) return;
  paymentButton.disabled = isSubmitting || !form.checkValidity();
}

function setFormStatus(message, type = "error") {
  if (!formStatus) return;

  formStatus.textContent = message;
  formStatus.dataset.status = type;
  formStatus.hidden = !message;
}

function setFieldError(fieldName, message) {
  const field = form?.querySelector(`[data-field="${fieldName}"]`);
  const errorNode = form?.querySelector(`[data-field-error="${fieldName}"]`);

  if (field) {
    field.dataset.invalid = message ? "true" : "false";
  }

  if (errorNode) {
    errorNode.textContent = message;
    errorNode.hidden = !message;
  }
}

function clearFieldErrors() {
  setFieldError("email", "");
  setFieldError("phone", "");
  setFormStatus("");
}

function shouldTreatWaitlistErrorAsSuccess(error) {
  if (!error || FORM_MODE !== "waitlist") return false;

  const code = String(error.code || "");
  const message = String(error.message || "").toLowerCase();

  // For waitlist UX: if row already exists, or waitlist table/RLS is not yet deployed,
  // still show confirmation screen instead of a hard failure page.
  return (
    code === "23505" || // unique violation (already in waitlist)
    code === "42P01" || // waitlist table missing
    code === "42501" || // policy/permission gap
    message.includes("duplicate key")
  );
}

function loadSupabaseLibrary() {
  if (window.supabase?.createClient) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const existingScript = document.querySelector("script[data-supabase-js]");

    if (existingScript) {
      existingScript.addEventListener("load", () => resolve(), { once: true });
      existingScript.addEventListener(
        "error",
        () => reject(new Error("Failed to load Supabase.")),
        {
          once: true,
        }
      );
      return;
    }

    const script = document.createElement("script");
    script.src = SUPABASE_CDN_URL;
    script.async = true;
    script.dataset.supabaseJs = "true";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Supabase."));
    document.head.appendChild(script);
  });
}

async function getSupabaseClient() {
  if (!supabaseClientPromise) {
    supabaseClientPromise = (async () => {
      await loadSupabaseLibrary();
      return window.supabase.createClient(
        SUPABASE_URL,
        SUPABASE_PUBLISHABLE_KEY,
        {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: false,
          },
        }
      );
    })();
  }

  return supabaseClientPromise;
}

async function getTournamentRegistrationCount(supabase) {
  const rpcResult = await supabase.rpc(REGISTRATION_COUNT_RPC, {
    p_tournament_slug: TOURNAMENT_SLUG,
  });
  if (!rpcResult.error) {
    return coerceCountValue(rpcResult.data);
  }

  const { count, error } = await supabase
    .from(REGISTRATIONS_TABLE)
    .select("id", { count: "exact", head: true })
    .eq("tournament_slug", TOURNAMENT_SLUG);

  if (error) throw error;
  return coerceCountValue(count);
}

async function isRegistrationFull(supabase) {
  const count = await getTournamentRegistrationCount(supabase);
  return count >= TEST_REGISTRATION_LIMIT;
}

function getFormPayload() {
  const formData = new FormData(form);

  return {
    tournament_name: TOURNAMENT_NAME,
    tournament_slug: TOURNAMENT_SLUG,
    full_name: String(formData.get("full-name") || "").trim(),
    skill_level: Number(formData.get("skill")),
    email: normalizeEmailForMatch(formData.get("email")),
    phone_country_code: "+91",
    phone_number: String(formData.get("phone") || "").trim(),
    terms_accepted: Boolean(formData.get("terms")),
    source_path: window.location.pathname,
  };
}

async function getCurrentSession(supabase) {
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    console.warn("Unable to read auth session:", error.message);
    return null;
  }

  return data?.session || null;
}

async function checkRegistrationAvailability(supabase, payload) {
  const { data, error } = await supabase.rpc(REGISTRATION_AVAILABILITY_RPC, {
    p_tournament_slug: payload.tournament_slug,
    p_email: payload.email,
    p_phone_country_code: payload.phone_country_code,
    p_phone_number: payload.phone_number,
  });

  if (error) throw error;

  const result = Array.isArray(data) ? data[0] : data;
  return {
    emailRegistered: Boolean(result?.email_registered),
    phoneRegistered: Boolean(result?.phone_registered),
    loggedInRegistered: Boolean(result?.logged_in_registered),
  };
}

function showDuplicateRegistrationWarnings(availability) {
  if (availability.emailRegistered) {
    setFieldError("email", "Gmail ID already registered");
  }

  if (availability.phoneRegistered) {
    setFieldError("phone", "Phone number already registered");
  }

  return availability.emailRegistered || availability.phoneRegistered;
}

async function createCashfreeOrder(payload) {
  const response = await fetch(CASHFREE_ORDER_FUNCTION_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const responseBody = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      responseBody.error || "Unable to create Cashfree payment order."
    );
  }

  if (!responseBody.paymentSessionId || !responseBody.orderId) {
    throw new Error("Cashfree payment session was not returned.");
  }

  return responseBody;
}

async function openCashfreeCheckout(paymentSessionId) {
  if (typeof window.Cashfree !== "function") {
    throw new Error("Cashfree checkout SDK is not loaded.");
  }

  const cashfree = window.Cashfree({ mode: CASHFREE_MODE });
  return cashfree.checkout({
    paymentSessionId,
    redirectTarget: "_self",
  });
}

async function saveRegistration(payload) {
  const supabase = await getSupabaseClient();
  const tableName = TABLE_BY_MODE[FORM_MODE] || REGISTRATIONS_TABLE;
  const { error } = await supabase.from(tableName).insert(payload);
  if (error) throw error;
}

function isDuplicateRegistrationError(error) {
  const code = String(error?.code || "");
  const message = String(error?.message || "").toLowerCase();
  return code === "23505" || message.includes("duplicate key");
}

if (form && paymentButton) {
  form.addEventListener("input", () => {
    clearFieldErrors();
    updatePaymentState();
  });
  form.addEventListener("change", updatePaymentState);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearFieldErrors();

    if (!form.checkValidity()) {
      form.reportValidity();
      updatePaymentState();
      return;
    }

    if (isSubmitting) return;

    isSubmitting = true;
    updatePaymentState();

    try {
      const supabase = await getSupabaseClient();

      if (FORM_MODE === "registration") {
        const full = await isRegistrationFull(supabase);
        if (full) {
          window.location.href = "/notify/";
          return;
        }
      }

      const payload = getFormPayload();
      const session = await getCurrentSession(supabase);
      const isLoggedIn = Boolean(session);
      let paymentOrder = null;

      if (FORM_MODE === "registration") {
        const availability = await checkRegistrationAvailability(supabase, payload);

        if (isLoggedIn && availability.loggedInRegistered) {
          localStorage.setItem(LAST_REGISTRATION_EMAIL_KEY, payload.email);
          window.location.href =
            SUCCESS_REDIRECT_BY_MODE[FORM_MODE] || "/registration_success/";
          return;
        }

        if (!isLoggedIn && showDuplicateRegistrationWarnings(availability)) {
          return;
        }

        paymentOrder = await createCashfreeOrder(payload);
      }

      try {
        await saveRegistration({
          ...payload,
          ...(paymentOrder
            ? {
                payment_status: "pending",
                cashfree_order_id: paymentOrder.orderId,
                cashfree_payment_session_id: paymentOrder.paymentSessionId,
              }
            : {}),
        });
      } catch (saveError) {
        if (
          FORM_MODE !== "registration" ||
          !paymentOrder ||
          !isDuplicateRegistrationError(saveError)
        ) {
          throw saveError;
        }

        console.warn(
          "Registration already exists for this email.",
          saveError
        );
        setFieldError("email", "Gmail ID already registered");
        return;
      }
      localStorage.setItem(LAST_REGISTRATION_EMAIL_KEY, payload.email);
      if (FORM_MODE === "registration") {
        await openCashfreeCheckout(paymentOrder.paymentSessionId);
        return;
      }
      window.location.href =
        SUCCESS_REDIRECT_BY_MODE[FORM_MODE] || "/registration_success/";
    } catch (error) {
      console.error("Failed to save form submission:", error);
      if (FORM_MODE === "waitlist" && shouldTreatWaitlistErrorAsSuccess(error)) {
        window.location.href = "/waitlist_confirmed/";
        return;
      }
      window.location.href =
        FORM_MODE === "waitlist" ? "/waitlist_confirmed/" : "/registration_failed/";
    } finally {
      isSubmitting = false;
      updatePaymentState();
    }
  });

  updatePaymentState();
}
