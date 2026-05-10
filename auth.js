const AUTH_KEY = "yarddeck_logged_in";

if (window.location.pathname.startsWith("/user-account")) {
  localStorage.setItem(AUTH_KEY, "true");
}

document.querySelectorAll("[data-login-link]").forEach((link) => {
  link.addEventListener("click", () => {
    localStorage.setItem(AUTH_KEY, "true");
  });
});

document.querySelectorAll("[data-logout-link]").forEach((link) => {
  link.addEventListener("click", () => {
    localStorage.removeItem(AUTH_KEY);
  });
});

if (localStorage.getItem(AUTH_KEY) === "true") {
  document.querySelectorAll(".account-link").forEach((link) => {
    link.href = "/user-account/";
    link.classList.add("account-link-signed-in");
    link.setAttribute("aria-label", "Account");
    link.innerHTML = '<img src="/assets/account-signed-in.svg" alt="" aria-hidden="true">';
  });
}
