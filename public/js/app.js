const yearElement = document.querySelector("#year");

if (yearElement) {
  yearElement.textContent = new Date().getFullYear().toString();
}

const orderNumberElement = document.querySelector("#orderNumber");

if (orderNumberElement) {
  const params = new URLSearchParams(window.location.search);
  const orderId = params.get("order") || sessionStorage.getItem("lastOrderId") || "-";
  orderNumberElement.textContent = orderId;
}
