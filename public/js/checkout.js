const packages = {
  "NF-1": {
    label: "Nutriflakes 1 Box",
    amount: 95000
  },
  "NF-2": {
    label: "Nutriflakes 2 Box",
    amount: 190000
  },
  "NF-3": {
    label: "Nutriflakes 3 Box",
    amount: 276000
  }
};

const form = document.querySelector("#checkoutForm");
const totalElement = document.querySelector("#orderTotal");
const packageSelect = document.querySelector("#packageId");
const formAlert = document.querySelector("#formAlert");
let isSubmitting = false;

const currencyFormatter = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0
});

function setError(fieldName, message) {
  const field = document.querySelector(`[name="${fieldName}"]`);
  const fieldWrap = field?.closest(".field");
  const errorElement = document.querySelector(`[data-error-for="${fieldName}"]`);

  fieldWrap?.classList.toggle("invalid", Boolean(message));

  if (errorElement) {
    errorElement.textContent = message;
  }
}

function setAlert(message, type = "info") {
  if (!formAlert) return;

  formAlert.textContent = message;
  formAlert.className = `form-alert visible ${type}`;
}

function clearAlert() {
  if (!formAlert) return;

  formAlert.textContent = "";
  formAlert.className = "form-alert";
}

function normalizeWhatsapp(value) {
  const cleaned = value.replace(/[^\d+]/g, "");

  if (cleaned.startsWith("+62")) return cleaned.slice(1);
  if (cleaned.startsWith("0")) return `62${cleaned.slice(1)}`;

  return cleaned;
}

function getClientRequestId() {
  const storageKey = "pendingClientRequestId";
  const existing = sessionStorage.getItem(storageKey);

  if (existing) {
    return existing;
  }

  const nextId = crypto.randomUUID();
  sessionStorage.setItem(storageKey, nextId);

  return nextId;
}

function clearPendingClientRequestId() {
  sessionStorage.removeItem("pendingClientRequestId");
}

function validate(payload) {
  const errors = {};
  const customerName = payload.customer_name.trim();
  const phone = normalizeWhatsapp(payload.phone);
  const address = payload.address.trim();
  const productCode = payload.product_code.trim().toUpperCase();

  if (customerName.length < 2 || customerName.length > 100) {
    errors.fullName = "Nama pembeli harus 2 sampai 100 karakter.";
  }

  if (!/^628\d{8,12}$/.test(phone)) {
    errors.whatsapp = "Masukkan nomor WhatsApp Indonesia yang valid.";
  }

  if (address.length < 5 || address.length > 500) {
    errors.address = "Alamat harus 5 sampai 500 karakter.";
  }

  if (!packages[productCode]) {
    errors.packageId = "Pilih salah satu paket.";
  }

  return {
    errors,
    cleaned: {
      customer_name: customerName,
      phone,
      address,
      product_code: productCode,
      client_request_id: payload.client_request_id
    }
  };
}

function updateTotal() {
  if (!packageSelect || !totalElement) return;

  const selectedPackage = packages[packageSelect.value];
  totalElement.textContent = selectedPackage ? currencyFormatter.format(selectedPackage.amount) : "Rp 0";
}

async function createOrder(payload) {
  const response = await fetch("/api/create-order", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message || "Pembayaran belum dapat dibuat. Silakan coba kembali.");
  }

  return data;
}

if (packageSelect) {
  packageSelect.addEventListener("change", updateTotal);
  updateTotal();
}

if (form) {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (isSubmitting) return;

    clearAlert();

    const formData = new FormData(form);
    const payload = {
      customer_name: String(formData.get("fullName") || ""),
      phone: String(formData.get("whatsapp") || ""),
      address: String(formData.get("address") || ""),
      product_code: String(formData.get("packageId") || ""),
      client_request_id: getClientRequestId()
    };

    ["fullName", "whatsapp", "address", "packageId"].forEach((fieldName) => setError(fieldName, ""));

    const { errors, cleaned } = validate(payload);

    if (Object.keys(errors).length > 0) {
      Object.entries(errors).forEach(([fieldName, message]) => setError(fieldName, message));
      setAlert("Periksa kembali data pesanan kamu.", "error");
      return;
    }

    const submitButton = form.querySelector("button[type='submit']");
    isSubmitting = true;
    submitButton.disabled = true;
    submitButton.textContent = "Membuat pembayaran...";
    setAlert("Membuat pembayaran QRIS...", "info");

    try {
      const result = await createOrder(cleaned);
      sessionStorage.setItem("lastOrderId", result.order_id);
      sessionStorage.setItem("lastPaymentOrder", JSON.stringify(result));
      clearPendingClientRequestId();
      window.location.href = `/checkout.html?order_id=${encodeURIComponent(result.order_id)}`;
    } catch (error) {
      setAlert(error.message || "Pembayaran belum dapat dibuat. Silakan coba kembali.", "error");
      isSubmitting = false;
      submitButton.disabled = false;
      submitButton.textContent = "Buat Pesanan QRIS";
    }
  });
}
