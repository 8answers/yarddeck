const AUTH_KEY = "yarddeck_logged_in";
const SUPABASE_URL = "https://hkdeqyyzuajjzjcmfgzx.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable__EFfpHtvXJR3zGb5KWs6eg_-j1F6fEf";
const SUPABASE_CDN_URL = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
const REGISTRATIONS_TABLE = "tournament_registrations";
const TOURNAMENT_SLUG = "the_yard_knockout";
const LAST_REGISTRATION_EMAIL_KEY = "yarddeck_last_registration_email";

function updateAccountLinks(isSignedIn) {
  document.querySelectorAll(".account-link").forEach((link) => {
    if (isSignedIn) {
      link.href = "/user-account/";
      link.classList.add("account-link-signed-in");
      link.setAttribute("aria-label", "Account");
      link.innerHTML = '<img src="/assets/account-signed-in.svg" alt="" aria-hidden="true">';
      return;
    }

    link.href = "/account/";
    link.classList.remove("account-link-signed-in");
    link.removeAttribute("aria-label");
    link.innerHTML = 'Account <img src="/assets/arrow-dark.svg" alt="" aria-hidden="true">';
  });
}

function updateAccountName(session) {
  const nameNode = document.getElementById("account-name");
  if (!nameNode) return;

  const user = session?.user;
  const userName =
    user?.user_metadata?.full_name ||
    user?.user_metadata?.name ||
    user?.email ||
    "Player";
  nameNode.textContent = userName;
}

function setTournamentParticipationVisible(isVisible) {
  document
    .querySelectorAll("[data-participation-heading], [data-participation-card]")
    .forEach((node) => {
      node.hidden = !isVisible;
    });
}

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

async function hasRegistrationForCurrentUser(supabaseClient, email) {
  const normalizedEmail = normalizeEmailForMatch(email);
  if (!normalizedEmail) return false;

  const rpcResult = await supabaseClient.rpc("has_registered_for_tournament", {
    p_tournament_slug: TOURNAMENT_SLUG,
  });
  if (!rpcResult.error && typeof rpcResult.data === "boolean") {
    return rpcResult.data;
  }

  const byTournament = await supabaseClient
    .from(REGISTRATIONS_TABLE)
    .select("id, email")
    .eq("tournament_slug", TOURNAMENT_SLUG)
    .limit(50);

  if (byTournament.error) {
    throw byTournament.error;
  }

  if (
    Array.isArray(byTournament.data) &&
    byTournament.data.some(
      (row) => normalizeEmailForMatch(row?.email) === normalizedEmail
    )
  ) {
    return true;
  }

  // Fallback: if older rows missed slug normalization, allow by email match.
  const byEmail = await supabaseClient
    .from(REGISTRATIONS_TABLE)
    .select("id, email")
    .limit(200);

  if (byEmail.error) {
    throw byEmail.error;
  }

  return (
    Array.isArray(byEmail.data) &&
    byEmail.data.some(
      (row) => normalizeEmailForMatch(row?.email) === normalizedEmail
    )
  );
}

async function syncTournamentParticipation(supabaseClient, session) {
  const participationNodes = document.querySelectorAll(
    "[data-participation-heading], [data-participation-card]"
  );
  if (!participationNodes.length) return;

  const sessionEmail =
    session?.user?.email || session?.user?.user_metadata?.email || null;

  if (!supabaseClient || !sessionEmail) {
    setTournamentParticipationVisible(false);
    return;
  }

  const email = normalizeEmailForMatch(sessionEmail);

  try {
    const hasRegistration = await hasRegistrationForCurrentUser(
      supabaseClient,
      email
    );
    if (hasRegistration) {
      setTournamentParticipationVisible(true);
      return;
    }
  } catch (error) {
    console.error(
      "Failed to load tournament participation from Supabase:",
      error?.message || error
    );
  }

  // Local fallback for same-browser flow if DB read policy is not yet applied.
  const localEmail = normalizeEmailForMatch(
    localStorage.getItem(LAST_REGISTRATION_EMAIL_KEY) || ""
  );
  setTournamentParticipationVisible(localEmail !== "" && localEmail === email);
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

async function createSupabaseClient() {
  try {
    await loadSupabaseLibrary();
    return window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  } catch (error) {
    console.error(error);
    return null;
  }
}

function setupLoginHandlers(supabaseClient) {
  document.querySelectorAll("[data-login-link]").forEach((link) => {
    link.addEventListener("click", async (event) => {
      if (!supabaseClient) {
        localStorage.setItem(AUTH_KEY, "true");
        return;
      }

      event.preventDefault();

      const { error } = await supabaseClient.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/user-account/`,
        },
      });

      if (error) {
        console.error("Google sign-in failed:", error.message);
      }
    });
  });
}

function setupLogoutHandlers(supabaseClient) {
  document.querySelectorAll("[data-logout-link]").forEach((link) => {
    link.addEventListener("click", async (event) => {
      localStorage.removeItem(AUTH_KEY);

      if (supabaseClient) {
        event.preventDefault();
        await supabaseClient.auth.signOut();
        window.location.href = "/";
      }
    });
  });
}

async function initAuth() {
  const supabaseClient = await createSupabaseClient();
  setupLoginHandlers(supabaseClient);
  setupLogoutHandlers(supabaseClient);

  if (!supabaseClient) {
    const isLoggedInFallback = localStorage.getItem(AUTH_KEY) === "true";
    updateAccountLinks(isLoggedInFallback);
    setTournamentParticipationVisible(false);

    if (window.location.pathname.startsWith("/user-account") && !isLoggedInFallback) {
      window.location.replace("/account/");
    }
    return;
  }

  const { data } = await supabaseClient.auth.getSession();
  const session = data?.session || null;
  const isLoggedIn = Boolean(session);

  if (isLoggedIn) {
    localStorage.setItem(AUTH_KEY, "true");
  } else {
    localStorage.removeItem(AUTH_KEY);
  }

  updateAccountLinks(isLoggedIn);
  updateAccountName(session);
  await syncTournamentParticipation(supabaseClient, session);

  if (window.location.pathname.startsWith("/user-account") && !isLoggedIn) {
    window.location.replace("/account/");
  }

  supabaseClient.auth.onAuthStateChange(async (_event, nextSession) => {
    const signedIn = Boolean(nextSession);
    if (signedIn) {
      localStorage.setItem(AUTH_KEY, "true");
    } else {
      localStorage.removeItem(AUTH_KEY);
    }

    updateAccountLinks(signedIn);
    updateAccountName(nextSession);
    await syncTournamentParticipation(supabaseClient, nextSession);

    if (!signedIn && window.location.pathname.startsWith("/user-account")) {
      window.location.replace("/account/");
    }
  });
}

initAuth();
