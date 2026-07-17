const packages = {
  "nf-1": {
    label: "Paket 1 Box",
    amount: 149000
  },
  "nf-2": {
    label: "Paket 2 Box",
    amount: 279000
  },
  "nf-3": {
    label: "Paket 3 Box",
    amount: 399000
  }
};

const form = document.querySelector("#checkoutForm");
const totalElement = document.querySelector("#orderTotal");
const packageSelect = document.querySelector("#packageId");
const formAlert = document.querySelector("#formAlert");

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
  return value.replace(/[^\d+]/g, "").replace(/^(\+62|62)/, "0");
}

function validate(payload) {
  const errors = {};
  const fullName = payload.fullName.trim();
  const whatsapp = normalizeWhatsapp(payload.whatsapp);
  const address = payload.address.trim();

  if (fullName.length < 3) {
    errors.fullName = "Nama lengkap minimal 3 karakter.";
  }

  if (!/^08\d{8,13}$/.test(whatsapp)) {
    errors.whatsapp = "Masukkan nomor WhatsApp Indonesia yang valid.";
  }

  if (address.length < 12) {
    errors.address = "Alamat terlalu singkat. Lengkapi detail pengiriman.";
  }

  if (!packages[payload.packageId]) {
    errors.packageId = "Pilih salah satu paket.";
  }

  return {
    errors,
    cleaned: {
      ...payload,
      fullName,
      whatsapp,
      address
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
    throw new Error(data.message || "Pesanan belum dapat dibuat.");
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
    clearAlert();

    const formData = new FormData(form);
    const payload = {
      fullName: String(formData.get("fullName") || ""),
      whatsapp: String(formData.get("whatsapp") || ""),
      address: String(formData.get("address") || ""),
      packageId: String(formData.get("packageId") || "")
    };

    Object.keys(payload).forEach((fieldName) => setError(fieldName, ""));

    const { errors, cleaned } = validate(payload);

    if (Object.keys(errors).length > 0) {
      Object.entries(errors).forEach(([fieldName, message]) => setError(fieldName, message));
      setAlert("Periksa kembali data pesanan kamu.", "error");
      return;
    }

    const submitButton = form.querySelector("button[type='submit']");
    submitButton.disabled = true;
    submitButton.textContent = "Membuat pesanan...";

    try {
      const result = await createOrder(cleaned);
      sessionStorage.setItem("lastOrderId", result.order_id);
      window.location.href = `/sukses.html?order=${encodeURIComponent(result.order_id)}`;
    } catch (error) {
      setAlert(error.message || "Terjadi kendala saat membuat pesanan.", "error");
      submitButton.disabled = false;
      submitButton.textContent = "Buat Pesanan QRIS";
    }
  });
}
