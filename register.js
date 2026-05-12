const form = document.querySelector(".registration-form");
const paymentButton = document.querySelector(".payment-button");
const formStatus = document.querySelector("[data-form-status]");
const emailInput = form?.querySelector('input[name="email"]');
const sendOtpButton = document.querySelector("[data-send-otp]");
const otpInputs = Array.from(document.querySelectorAll("[data-otp-input]"));
const otpStatus = document.querySelector("[data-otp-status]");
const otpInputGroup = document.querySelector(".otp-inputs");
const SUPABASE_URL = "https://hkdeqyyzuajjzjcmfgzx.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable__EFfpHtvXJR3zGb5KWs6eg_-j1F6fEf";
const SUPABASE_CDN_URL = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
const REGISTRATIONS_TABLE = "tournament_registrations";
const WAITLIST_TABLE = "tournament_notify_emails";
const TOURNAMENT_NAME = "The Yard Knockout";
const TOURNAMENT_SLUG = "the_yard_knockout";
const LAST_REGISTRATION_EMAIL_KEY = "yarddeck_last_registration_email";
const TEST_REGISTRATION_LIMIT = 6;
const REGISTRATION_COUNT_RPC = "get_tournament_registration_count";
const REGISTRATION_AVAILABILITY_RPC = "check_tournament_registration_availability";
const WAITLIST_EMAIL_EXISTS_RPC = "check_tournament_notify_email_exists";
const CASHFREE_ORDER_FUNCTION_URL = "/.netlify/functions/create-cashfree-order";
const CASHFREE_MODE = "sandbox";
const OTP_RESEND_COOLDOWN_SECONDS = 60;
const OTP_SEND_LIMIT = 3;
const OTP_SEND_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const OTP_SEND_HISTORY_KEY = "yarddeck_otp_send_history_v3";
const OTP_BUTTON_TEXT = "Get OTP";
const EMAIL_DUPLICATE_CHECK_DEBOUNCE_MS = 350;

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
let isSendingOtp = false;
let isVerifyingOtp = false;
let isCheckingEmailDuplicate = false;
let isEmailAlreadyRegistered = false;
let isEmailVerified = false;
let hasAuthSession = false;
let otpSentForEmail = "";
let verifiedEmail = "";
let authSessionEmail = "";
let otpCooldownRemaining = 0;
let otpCooldownTimer = null;
let otpLimitTimer = null;
let emailDuplicateDebounceTimer = null;
let emailDuplicateCheckRequestId = 0;
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
  const requiresOtp = FORM_MODE === "registration" && otpInputs.length > 0;
  paymentButton.disabled =
    isSubmitting ||
    isCheckingEmailDuplicate ||
    isEmailAlreadyRegistered ||
    !form.checkValidity() ||
    (requiresOtp && !isEmailVerified && !hasAuthSession);

  if (sendOtpButton && emailInput) {
    sendOtpButton.disabled =
      isSubmitting ||
      isSendingOtp ||
      isVerifyingOtp ||
      isCheckingEmailDuplicate ||
      isEmailAlreadyRegistered ||
      isEmailVerified ||
      otpCooldownRemaining > 0 ||
      Boolean(otpLimitTimer) ||
      !emailInput.checkValidity();
  }
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

function setEmailVerifiedState(isVerified) {
  const emailField = form?.querySelector('[data-field="email"]');
  if (emailField) {
    emailField.dataset.verified = isVerified ? "true" : "false";
  }
}

function clearFieldErrors() {
  setFieldError("email", "");
  setFieldError("phone", "");
  setFormStatus("");
}

function setEmailDuplicateState(isDuplicate) {
  isEmailAlreadyRegistered = Boolean(isDuplicate);
  if (isEmailAlreadyRegistered) {
    setFieldError("email", "Email is already registered.");
    if (FORM_MODE === "registration") {
      setOtpStatus("Email is already registered.");
    }
  } else {
    setFieldError("email", "");
    if (FORM_MODE === "registration") {
      const currentOtpStatus = String(otpStatus?.textContent || "").toLowerCase();
      if (currentOtpStatus === "email is already registered.") {
        setOtpStatus("");
      }
    }
  }
}

function setOtpStatus(message, type = "error") {
  if (!otpStatus) return;

  otpStatus.textContent = message;
  otpStatus.dataset.status = type;
  otpStatus.hidden = !message;
  if (otpInputGroup) {
    otpInputGroup.dataset.status = message ? type : "";
  }
}

function clearOtpInputStatus() {
  if (otpInputGroup) {
    otpInputGroup.dataset.status = "";
  }
}

function isCurrentEmailBackedBySession(email = emailInput?.value || "") {
  const normalizedEmail = normalizeEmailForMatch(email);
  return Boolean(authSessionEmail && normalizedEmail && normalizedEmail === authSessionEmail);
}

function resetOtpState() {
  const currentEmail = normalizeEmailForMatch(emailInput?.value || "");
  if (isEmailVerified && currentEmail === verifiedEmail) {
    hasAuthSession = isCurrentEmailBackedBySession(currentEmail);
    updatePaymentState();
    return;
  }

  if (isCurrentEmailBackedBySession(currentEmail)) {
    hasAuthSession = true;
    isEmailVerified = true;
    verifiedEmail = currentEmail;
    setEmailVerifiedState(true);
    otpInputs.forEach((input) => {
      input.value = "";
      input.disabled = true;
    });
    setOtpStatus("Email already verified", "success");
    updatePaymentState();
    return;
  }

  hasAuthSession = false;
  isEmailVerified = false;
  otpSentForEmail = "";
  verifiedEmail = "";
  setEmailVerifiedState(false);
  otpCooldownRemaining = 0;
  if (otpCooldownTimer) {
    clearInterval(otpCooldownTimer);
    otpCooldownTimer = null;
  }
  if (otpLimitTimer) {
    clearInterval(otpLimitTimer);
    otpLimitTimer = null;
  }
  otpInputs.forEach((input) => {
    input.value = "";
    input.disabled = false;
  });
  updateOtpButtonText();
  setOtpStatus("");
  updatePaymentState();
}

function updateOtpButtonText() {
  if (!sendOtpButton) return;

  sendOtpButton.textContent =
    otpCooldownRemaining > 0
      ? `${OTP_BUTTON_TEXT} (${otpCooldownRemaining}s)`
      : OTP_BUTTON_TEXT;
}

function updateOtpLimitButtonText(remainingSeconds) {
  if (!sendOtpButton) return;
  sendOtpButton.textContent = `${OTP_BUTTON_TEXT} (${formatOtpLimitTime(
    remainingSeconds
  )})`;
}

function startOtpCooldown(seconds = OTP_RESEND_COOLDOWN_SECONDS) {
  otpCooldownRemaining = seconds;
  updateOtpButtonText();
  updatePaymentState();

  if (otpCooldownTimer) {
    clearInterval(otpCooldownTimer);
  }

  otpCooldownTimer = setInterval(() => {
    otpCooldownRemaining = Math.max(otpCooldownRemaining - 1, 0);
    updateOtpButtonText();
    updatePaymentState();

    if (otpCooldownRemaining === 0 && otpCooldownTimer) {
      clearInterval(otpCooldownTimer);
      otpCooldownTimer = null;
    }
  }, 1000);
}

function getOtpSendHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(OTP_SEND_HISTORY_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    return {};
  }
}

function setOtpSendHistory(history) {
  localStorage.setItem(OTP_SEND_HISTORY_KEY, JSON.stringify(history));
}

function getRecentOtpSendTimes(email) {
  const now = Date.now();
  const history = getOtpSendHistory();
  return (Array.isArray(history[email]) ? history[email] : []).filter(
    (sentAt) => now - Number(sentAt) < OTP_SEND_LIMIT_WINDOW_MS
  );
}

function recordOtpSend(email) {
  const history = getOtpSendHistory();
  history[email] = [...getRecentOtpSendTimes(email), Date.now()];
  setOtpSendHistory(history);
  return history[email].length;
}

function getOtpSentMessage(sendCount) {
  if (sendCount === 1) {
    return "A verification code has been sent to your email.";
  }

  if (sendCount === 2) {
    return "A new verification code has been sent to your email.";
  }

  return "Another new verification code has been sent to your email.";
}

function getOtpLimitRemainingSeconds(email) {
  const recentSends = getRecentOtpSendTimes(email);
  if (recentSends.length < OTP_SEND_LIMIT) return 0;

  const oldestSend = Math.min(...recentSends);
  return Math.max(
    Math.ceil((OTP_SEND_LIMIT_WINDOW_MS - (Date.now() - oldestSend)) / 1000),
    0
  );
}

function formatOtpLimitTime(totalSeconds) {
  const totalMinutes = Math.max(Math.ceil(totalSeconds / 60), 1);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function setOtpLimitStatus(remainingSeconds) {
  setOtpStatus(
    `Please wait 1 hr (${formatOtpLimitTime(
      remainingSeconds
    )}) before requesting another OTP's.`
  );
}

function startOtpLimitTimer(email) {
  if (otpLimitTimer) {
    clearInterval(otpLimitTimer);
  }

  const tick = () => {
    const remainingSeconds = getOtpLimitRemainingSeconds(email);
    if (remainingSeconds <= 0) {
      clearInterval(otpLimitTimer);
      otpLimitTimer = null;
      setOtpStatus("");
      updateOtpButtonText();
      updatePaymentState();
      return;
    }

    setOtpLimitStatus(remainingSeconds);
    updateOtpLimitButtonText(remainingSeconds);
  };

  tick();
  otpLimitTimer = setInterval(tick, 60 * 1000);
}

function shouldTreatWaitlistErrorAsSuccess(error) {
  return false;
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

function getCurrentOtpCode() {
  return otpInputs.map((input) => input.value.trim()).join("");
}

async function getCurrentSession(supabase) {
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    console.warn("Unable to read auth session:", error.message);
    return null;
  }

  return data?.session || null;
}

async function syncOtpStateWithSession() {
  if (FORM_MODE !== "registration" || !otpInputs.length) return;

  try {
    const supabase = await getSupabaseClient();
    const session = await getCurrentSession(supabase);
    authSessionEmail = normalizeEmailForMatch(session?.user?.email || "");
    resetOtpState();
  } catch (error) {
    console.warn("Unable to initialize OTP state:", error.message || error);
  } finally {
    updatePaymentState();
  }
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
    setFieldError("email", "Email is already registered.");
  }

  if (availability.phoneRegistered) {
    setFieldError("phone", "Phone number already registered");
  }

  return availability.emailRegistered || availability.phoneRegistered;
}

async function checkNotifyEmailExists(supabase, email) {
  const rpcResult = await supabase.rpc(WAITLIST_EMAIL_EXISTS_RPC, {
    p_tournament_slug: TOURNAMENT_SLUG,
    p_email: email,
  });

  if (!rpcResult.error) {
    return Boolean(rpcResult.data);
  }

  const rpcCode = String(rpcResult.error.code || "");
  if (rpcCode !== "PGRST202") {
    throw rpcResult.error;
  }

  // Fallback if the RPC function is not yet available in PostgREST cache.
  const { data, error } = await supabase
    .from(WAITLIST_TABLE)
    .select("id")
    .eq("tournament_slug", TOURNAMENT_SLUG)
    .eq("email", email)
    .limit(1);

  if (error) throw error;
  return Array.isArray(data) && data.length > 0;
}

async function checkDuplicateEmailByMode(supabase, email) {
  if (!email) return false;

  if (FORM_MODE === "waitlist") {
    return checkNotifyEmailExists(supabase, email);
  }

  const availability = await checkRegistrationAvailability(supabase, {
    tournament_slug: TOURNAMENT_SLUG,
    email,
    phone_country_code: "+91",
    phone_number: "",
  });

  return Boolean(availability.emailRegistered);
}

async function refreshEmailDuplicateState() {
  if (!emailInput) return false;

  const normalizedEmail = normalizeEmailForMatch(emailInput.value || "");
  if (!normalizedEmail || !emailInput.checkValidity()) {
    isCheckingEmailDuplicate = false;
    setEmailDuplicateState(false);
    updatePaymentState();
    return false;
  }

  const requestId = ++emailDuplicateCheckRequestId;
  isCheckingEmailDuplicate = true;
  updatePaymentState();

  try {
    const supabase = await getSupabaseClient();
    const duplicate = await checkDuplicateEmailByMode(supabase, normalizedEmail);
    if (requestId !== emailDuplicateCheckRequestId) return false;
    setEmailDuplicateState(duplicate);
    return duplicate;
  } catch (error) {
    console.warn("Unable to check duplicate email:", error.message || error);
    if (requestId !== emailDuplicateCheckRequestId) return false;
    setEmailDuplicateState(false);
    return false;
  } finally {
    if (requestId === emailDuplicateCheckRequestId) {
      isCheckingEmailDuplicate = false;
      updatePaymentState();
    }
  }
}

function scheduleEmailDuplicateStateRefresh() {
  if (emailDuplicateDebounceTimer) {
    clearTimeout(emailDuplicateDebounceTimer);
  }

  const normalizedEmail = normalizeEmailForMatch(emailInput?.value || "");
  if (normalizedEmail && emailInput?.checkValidity()) {
    isCheckingEmailDuplicate = true;
    updatePaymentState();
  } else {
    isCheckingEmailDuplicate = false;
    setEmailDuplicateState(false);
    updatePaymentState();
  }

  emailDuplicateDebounceTimer = setTimeout(() => {
    refreshEmailDuplicateState();
  }, EMAIL_DUPLICATE_CHECK_DEBOUNCE_MS);
}

async function sendEmailOtp() {
  if (!emailInput || !sendOtpButton) return;

  clearFieldErrors();
  setOtpStatus("");

  if (!emailInput.checkValidity()) {
    emailInput.reportValidity();
    updatePaymentState();
    return;
  }

  const emailAlreadyExists = await refreshEmailDuplicateState();
  if (emailAlreadyExists) {
    updatePaymentState();
    return;
  }

  const supabase = await getSupabaseClient();
  const email = normalizeEmailForMatch(emailInput.value);
  if (getRecentOtpSendTimes(email).length >= OTP_SEND_LIMIT) {
    startOtpLimitTimer(email);
    updatePaymentState();
    return;
  }

  const session = await getCurrentSession(supabase);
  authSessionEmail = normalizeEmailForMatch(session?.user?.email || "");
  hasAuthSession = isCurrentEmailBackedBySession(email);

  if (hasAuthSession) {
    isEmailVerified = true;
    verifiedEmail = email;
    setEmailVerifiedState(true);
    setOtpStatus("Email already verified", "success");
    otpInputs.forEach((input) => {
      input.disabled = true;
    });
    updatePaymentState();
    return;
  }

  try {
    isSendingOtp = true;
    updatePaymentState();

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: true,
      },
    });

    if (error) throw error;

    otpSentForEmail = email;
    const sendCount = recordOtpSend(email);
    startOtpCooldown();
    setOtpStatus(getOtpSentMessage(sendCount), "success");
    otpInputs[0]?.focus();
  } catch (error) {
    console.error("Failed to send OTP:", error);
    const status = Number(error?.status || error?.statusCode || 0);
    const code = String(error?.code || "").toLowerCase();
    const message = String(error?.message || "").toLowerCase();

    if (
      status === 429 ||
      code.includes("rate") ||
      message.includes("rate limit")
    ) {
      startOtpLimitTimer(email);
      setOtpStatus("Too many OTP requests. Please wait before trying again.");
    } else if (
      code === "email_address_not_authorized" ||
      message.includes("not authorized")
    ) {
      setOtpStatus("Email provider is not fully configured yet. Please try again shortly.");
    } else if (
      message.includes("smtp") ||
      message.includes("confirmation email") ||
      message.includes("send")
    ) {
      setOtpStatus("OTP could not be sent right now. Please try again in a minute.");
    } else {
      setOtpStatus("Unable to send OTP right now. Please try again.");
    }
  } finally {
    isSendingOtp = false;
    updatePaymentState();
  }
}

async function verifyEmailOtp() {
  if (isVerifyingOtp || isEmailVerified || !otpSentForEmail) return;

  const token = getCurrentOtpCode();
  if (token.length !== otpInputs.length) return;

  try {
    isVerifyingOtp = true;
    updatePaymentState();
    setOtpStatus("");

    const supabase = await getSupabaseClient();
    const verificationTypes = ["email", "signup", "magiclink"];
    let verifyError = null;

    for (const type of verificationTypes) {
      const { error } = await supabase.auth.verifyOtp({
        email: otpSentForEmail,
        token,
        type,
      });

      if (!error) {
        verifyError = null;
        break;
      }

      verifyError = error;
    }

    if (verifyError) throw verifyError;

    hasAuthSession = true;
    authSessionEmail = otpSentForEmail;
    isEmailVerified = true;
    verifiedEmail = otpSentForEmail;
    setEmailVerifiedState(true);
    otpInputs.forEach((input) => {
      input.disabled = true;
    });
    setOtpStatus("Email verified", "success");
  } catch (error) {
    console.error("Failed to verify OTP:", error);
    const message = String(error?.message || "").toLowerCase();
    if (message.includes("expired")) {
      setOtpStatus("OTP expired. Please request a new code.");
    } else {
      setOtpStatus("Invalid OTP. Please check the latest code and try again.");
    }
  } finally {
    isVerifyingOtp = false;
    updatePaymentState();
  }
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
  emailInput?.addEventListener("input", () => {
    resetOtpState();
    isEmailAlreadyRegistered = false;
    scheduleEmailDuplicateStateRefresh();
  });
  emailInput?.addEventListener("blur", () => {
    refreshEmailDuplicateState();
  });
  sendOtpButton?.addEventListener("click", sendEmailOtp);
  otpInputs.forEach((input, index) => {
    input.addEventListener("input", () => {
      input.value = input.value.replace(/\D/g, "").slice(0, 1);
      clearOtpInputStatus();
      if (getCurrentOtpCode().length < otpInputs.length) {
        setOtpStatus("");
      }

      if (input.value && otpInputs[index + 1]) {
        otpInputs[index + 1].focus();
      }

      verifyEmailOtp();
    });

    input.addEventListener("keydown", (event) => {
      if (event.key === "Backspace" && !input.value && otpInputs[index - 1]) {
        otpInputs[index - 1].focus();
      }
    });
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
      authSessionEmail = normalizeEmailForMatch(session?.user?.email || "");
      const isSessionEmailMatch = isCurrentEmailBackedBySession(payload.email);
      hasAuthSession = isSessionEmailMatch;
      if (isSessionEmailMatch) {
        isEmailVerified = true;
        verifiedEmail = payload.email;
        setEmailVerifiedState(true);
      }
      let paymentOrder = null;

      if (FORM_MODE === "registration") {
        if (otpInputs.length > 0 && !isEmailVerified && !isSessionEmailMatch) {
          setOtpStatus("Please verify your Gmail before payment.");
          return;
        }

        const availability = await checkRegistrationAvailability(supabase, payload);

        if (isSessionEmailMatch && availability.loggedInRegistered) {
          localStorage.setItem(LAST_REGISTRATION_EMAIL_KEY, payload.email);
          window.location.href =
            SUCCESS_REDIRECT_BY_MODE[FORM_MODE] || "/registration_success/";
          return;
        }

        if (!isSessionEmailMatch && showDuplicateRegistrationWarnings(availability)) {
          return;
        }

        paymentOrder = await createCashfreeOrder(payload);
      } else if (FORM_MODE === "waitlist") {
        const duplicateWaitlistEmail = await checkNotifyEmailExists(
          supabase,
          payload.email
        );
        if (duplicateWaitlistEmail) {
          setEmailDuplicateState(true);
          setFormStatus("Email is already registered.");
          return;
        }
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
        setFormStatus("Email is already registered.");
        setFieldError("email", "Email is already registered.");
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
      if (FORM_MODE === "waitlist") {
        const code = String(error?.code || "");
        if (isDuplicateRegistrationError(error)) {
          setEmailDuplicateState(true);
          setFormStatus("Email is already registered.");
          return;
        }
        if (code === "42P01" || code === "PGRST205") {
          setFormStatus("Notify table is not set up yet. Please run the latest database SQL setup.");
          return;
        }
        if (code === "42501" || code === "PGRST301" || code === "PGRST302") {
          setFormStatus("Notify insert permission is missing in database policies. Please run the latest SQL setup.");
          return;
        }
        setFormStatus(
          `Could not save your notify request right now. Please try again. (${code || "unknown"})`
        );
        return;
      }
      window.location.href = "/registration_failed/";
    } finally {
      isSubmitting = false;
      updatePaymentState();
    }
  });

  syncOtpStateWithSession();
  if (emailInput?.value) {
    scheduleEmailDuplicateStateRefresh();
  }
  updatePaymentState();
}
