const form = document.querySelector(".registration-form");
const paymentButton = document.querySelector(".payment-button");

function updatePaymentState() {
  paymentButton.disabled = !form.checkValidity();
}

form.addEventListener("input", updatePaymentState);
form.addEventListener("change", updatePaymentState);
form.addEventListener("submit", (event) => {
  event.preventDefault();

  if (!form.checkValidity()) {
    form.reportValidity();
    updatePaymentState();
    return;
  }

  window.location.href = "/registration_success/";
});

updatePaymentState();
