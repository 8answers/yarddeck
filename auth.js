const AUTH_KEY = "yarddeck_logged_in";
const SUPABASE_URL = "https://hkdeqyyzuajjzjcmfgzx.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable__EFfpHtvXJR3zGb5KWs6eg_-j1F6fEf";
const SUPABASE_CDN_URL = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";

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

  if (window.location.pathname.startsWith("/user-account") && !isLoggedIn) {
    window.location.replace("/account/");
  }

  supabaseClient.auth.onAuthStateChange((_event, nextSession) => {
    const signedIn = Boolean(nextSession);
    if (signedIn) {
      localStorage.setItem(AUTH_KEY, "true");
    } else {
      localStorage.removeItem(AUTH_KEY);
    }

    updateAccountLinks(signedIn);
    updateAccountName(nextSession);

    if (!signedIn && window.location.pathname.startsWith("/user-account")) {
      window.location.replace("/account/");
    }
  });
}

initAuth();
