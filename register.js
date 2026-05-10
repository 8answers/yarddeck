const form = document.querySelector(".registration-form");
const paymentButton = document.querySelector(".payment-button");
const SUPABASE_URL = "https://hkdeqyyzuajjzjcmfgzx.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable__EFfpHtvXJR3zGb5KWs6eg_-j1F6fEf";
const SUPABASE_CDN_URL = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
const REGISTRATIONS_TABLE = "tournament_registrations";
const TOURNAMENT_NAME = "The Yard Knockout";
const TOURNAMENT_SLUG = "the_yard_knockout";

let isSubmitting = false;
let supabaseClientPromise = null;

function updatePaymentState() {
  paymentButton.disabled = isSubmitting || !form.checkValidity();
}

function loadSupabaseLibrary() {
  if (window.supabase?.createClient) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const existingScript = document.querySelector("script[data-supabase-js]");

    if (existingScript) {
      existingScript.addEventListener("load", () => resolve(), { once: true });
      existingScript.addEventListener("error", () => reject(new Error("Failed to load Supabase.")), {
        once: true,
      });
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
      return window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      });
    })();
  }

  return supabaseClientPromise;
}

function getFormPayload() {
  const formData = new FormData(form);

  return {
    tournament_name: TOURNAMENT_NAME,
    tournament_slug: TOURNAMENT_SLUG,
    full_name: String(formData.get("full-name") || "").trim(),
    skill_level: Number(formData.get("skill")),
    email: String(formData.get("email") || "").trim().toLowerCase(),
    phone_country_code: "+91",
    phone_number: String(formData.get("phone") || "").trim(),
    terms_accepted: Boolean(formData.get("terms")),
    source_path: window.location.pathname,
  };
}

async function saveRegistration(payload) {
  const supabase = await getSupabaseClient();
  const { error } = await supabase.from(REGISTRATIONS_TABLE).insert(payload);
  if (error) throw error;
}

form.addEventListener("input", updatePaymentState);
form.addEventListener("change", updatePaymentState);
form.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!form.checkValidity()) {
    form.reportValidity();
    updatePaymentState();
    return;
  }

  if (isSubmitting) return;

  isSubmitting = true;
  updatePaymentState();

  try {
    const payload = getFormPayload();
    await saveRegistration(payload);
    window.location.href = "/registration_success/";
  } catch (error) {
    console.error("Failed to save registration:", error);
    window.location.href = "/registration_failed/";
  } finally {
    isSubmitting = false;
    updatePaymentState();
  }
});

updatePaymentState();
