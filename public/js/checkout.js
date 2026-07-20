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

const TERMINAL_STATUSES = new Set(["PAID", "EXPIRED", "PAYMENT_FAILED"]);
const ALLOWED_CASHI_HOSTS = ["cashi.id"];
const FETCH_TIMEOUT_MS = 8000;
const POLL_INTERVAL_MS = 3000;
const MAX_POLL_DURATION_MS = 10 * 60 * 1000;

const currencyFormatter = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0
});

const expiryFormatter = new Intl.DateTimeFormat("id-ID", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Jakarta"
});

function formatRupiah(amount) {
  const value = Number(amount);
  const safeAmount = Number.isFinite(value) ? value : 0;
  return currencyFormatter.format(safeAmount).replace(/\s+/g, "");
}

function parseCashiExpiry(value) {
  const text = String(value || "").trim();

  if (!text) {
    return null;
  }

  // Cashi can return Indonesian local time without timezone. Parse that format as WIB
  // so the countdown does not drift when the browser runs in another timezone.
  const localMatch = text.match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/
  );

  if (localMatch) {
    const [, year, month, day, hour, minute, second = "00"] = localMatch;
    const timestamp = Date.parse(`${year}-${month}-${day}T${hour}:${minute}:${second}+07:00`);
    return Number.isNaN(timestamp) ? null : timestamp;
  }

  const timestamp = Date.parse(text);
  return Number.isNaN(timestamp) ? null : timestamp;
}

function isHttpsUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    return url.protocol === "https:";
  } catch (error) {
    return false;
  }
}

function isValidQrUrl(value) {
  const text = String(value || "").trim();

  if (/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(text)) {
    return true;
  }

  return isHttpsUrl(text);
}

function isValidCheckoutUrl(value) {
  try {
    const url = new URL(String(value || "").trim());

    if (url.protocol !== "https:") {
      return false;
    }

    return ALLOWED_CASHI_HOSTS.some(
      (host) => url.hostname === host || url.hostname.endsWith(`.${host}`)
    );
  } catch (error) {
    return false;
  }
}

function normalizeWhatsapp(value) {
  const cleaned = value.replace(/[^\d+]/g, "");

  if (cleaned.startsWith("+62")) return cleaned.slice(1);
  if (cleaned.startsWith("0")) return `62${cleaned.slice(1)}`;

  return cleaned;
}

function formatCountdown(milliseconds) {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (hours > 0) {
    return `${hours} jam ${remainingMinutes} menit ${seconds} detik`;
  }

  return `${remainingMinutes} menit ${seconds} detik`;
}

function formatExpiry(value) {
  const timestamp = parseCashiExpiry(value);

  if (!timestamp) {
    return value ? String(value) : "-";
  }

  return `${expiryFormatter.format(timestamp)} WIB`;
}

function setText(element, value) {
  if (element) {
    element.textContent = value;
  }
}

function setAlert(element, message, type = "info") {
  if (!element) return;

  element.textContent = message;
  element.className = `form-alert visible ${type}`;
}

function clearAlert(element) {
  if (!element) return;

  element.textContent = "";
  element.className = "form-alert";
}

function setError(doc, fieldName, message) {
  const field = doc.querySelector(`[name="${fieldName}"]`);
  const fieldWrap = field?.closest(".field");
  const errorElement = doc.querySelector(`[data-error-for="${fieldName}"]`);

  fieldWrap?.classList.toggle("invalid", Boolean(message));

  if (errorElement) {
    errorElement.textContent = message;
  }
}

function getClientRequestId(storage) {
  const storageKey = "pendingClientRequestId";
  const existing = storage.getItem(storageKey);

  if (existing) {
    return existing;
  }

  const nextId = crypto.randomUUID();
  storage.setItem(storageKey, nextId);

  return nextId;
}

function clearPendingClientRequestId(storage) {
  storage.removeItem("pendingClientRequestId");
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

async function fetchWithTimeout(url, init = {}, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const timeoutMs = options.timeoutMs || FETCH_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetchImpl(url, {
      ...init,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function createOrder(payload, options = {}) {
  const response = await fetchWithTimeout(
    "/api/create-order",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    },
    options
  );

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message || "Pembayaran belum dapat dibuat. Silakan coba kembali.");
  }

  return data;
}

async function fetchOrderStatus(orderId, options = {}) {
  const response = await fetchWithTimeout(
    `/api/check-status?order_id=${encodeURIComponent(orderId)}`,
    {
      method: "GET",
      headers: {
        Accept: "application/json"
      }
    },
    options
  );

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message || "Status pembayaran belum dapat diperiksa.");
  }

  return data;
}

function createPaymentPollingController(options) {
  const {
    getStatus,
    onStatus,
    onError = () => {},
    onStop = () => {},
    documentRef = null,
    intervalMs = POLL_INTERVAL_MS,
    maxDurationMs = MAX_POLL_DURATION_MS,
    now = () => Date.now(),
    setTimeoutImpl = setTimeout,
    clearTimeoutImpl = clearTimeout
  } = options;

  let timerId = null;
  let startedAt = null;
  let inFlight = false;
  let stopped = true;
  let terminalReason = null;

  function visible() {
    return !documentRef || !documentRef.hidden;
  }

  function clearTimer() {
    if (timerId !== null) {
      clearTimeoutImpl(timerId);
      timerId = null;
    }
  }

  function stop(reason = "manual") {
    const wasActive = !stopped || timerId !== null || inFlight;
    stopped = true;
    clearTimer();

    if (TERMINAL_STATUSES.has(String(reason).toUpperCase())) {
      terminalReason = reason;
    }

    if (wasActive) {
      onStop(reason);
    }
  }

  function schedule() {
    if (stopped || timerId !== null || !visible()) {
      return;
    }

    if (startedAt !== null && now() - startedAt >= maxDurationMs) {
      stop("timeout");
      return;
    }

    timerId = setTimeoutImpl(() => {
      timerId = null;
      void checkNow();
    }, intervalMs);
  }

  async function checkNow() {
    if (terminalReason) {
      return;
    }

    if (inFlight || !visible()) {
      return;
    }

    if (startedAt === null) {
      startedAt = now();
    }

    if (now() - startedAt >= maxDurationMs) {
      stop("timeout");
      return;
    }

    stopped = false;
    inFlight = true;

    try {
      const order = await getStatus();
      const status = String(order.payment_status || "").toUpperCase();
      onStatus(order);

      if (TERMINAL_STATUSES.has(status)) {
        stop(status);
        return;
      }
    } catch (error) {
      onError(error);
    } finally {
      inFlight = false;
    }

    schedule();
  }

  function start({ immediate = false } = {}) {
    if (terminalReason) {
      return undefined;
    }

    if (startedAt === null) {
      startedAt = now();
    }

    if (!stopped && (timerId !== null || inFlight)) {
      return undefined;
    }

    stopped = false;

    if (immediate) {
      clearTimer();
      return checkNow();
    }

    schedule();
    return undefined;
  }

  function pause() {
    clearTimer();
  }

  function resume() {
    if (terminalReason) {
      return undefined;
    }

    if (stopped) {
      stopped = false;
    }

    clearTimer();
    return checkNow();
  }

  return {
    start,
    stop,
    pause,
    resume,
    checkNow,
    hasTimer: () => timerId !== null,
    isPolling: () => !stopped && (timerId !== null || inFlight)
  };
}

function updateTotal(doc) {
  const packageSelect = doc.querySelector("#packageId");
  const totalElement = doc.querySelector("#orderTotal");

  if (!packageSelect || !totalElement) return;

  const selectedPackage = packages[packageSelect.value];
  totalElement.textContent = selectedPackage ? formatRupiah(selectedPackage.amount) : "Rp0";
}

function initCreateOrderForm(doc, win) {
  const form = doc.querySelector("#checkoutForm");
  const packageSelect = doc.querySelector("#packageId");
  const formAlert = doc.querySelector("#formAlert");
  let isSubmitting = false;

  if (packageSelect) {
    packageSelect.addEventListener("change", () => updateTotal(doc));
    updateTotal(doc);
  }

  if (!form) {
    return;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (isSubmitting) return;

    clearAlert(formAlert);

    const formData = new FormData(form);
    const payload = {
      customer_name: String(formData.get("fullName") || ""),
      phone: String(formData.get("whatsapp") || ""),
      address: String(formData.get("address") || ""),
      product_code: String(formData.get("packageId") || ""),
      client_request_id: getClientRequestId(win.sessionStorage)
    };

    ["fullName", "whatsapp", "address", "packageId"].forEach((fieldName) =>
      setError(doc, fieldName, "")
    );

    const { errors, cleaned } = validate(payload);

    if (Object.keys(errors).length > 0) {
      Object.entries(errors).forEach(([fieldName, message]) => setError(doc, fieldName, message));
      setAlert(formAlert, "Periksa kembali data pesanan kamu.", "error");
      return;
    }

    const submitButton = form.querySelector("button[type='submit']");
    isSubmitting = true;
    submitButton.disabled = true;
    submitButton.textContent = "Membuat pembayaran...";
    setAlert(formAlert, "Membuat pembayaran QRIS...", "info");

    try {
      const result = await createOrder(cleaned, {
        fetchImpl: win.fetch.bind(win)
      });
      clearPendingClientRequestId(win.sessionStorage);
      win.location.assign(`/checkout.html?order_id=${encodeURIComponent(result.order_id)}`);
    } catch (error) {
      clearPendingClientRequestId(win.sessionStorage);
      setAlert(
        formAlert,
        error.message || "Pembayaran belum dapat dibuat. Silakan coba kembali.",
        "error"
      );
      isSubmitting = false;
      submitButton.disabled = false;
      submitButton.textContent = "Buat Pesanan QRIS";
    }
  });
}

function setPaymentStatus(statusElement, status) {
  if (!statusElement) return;

  const normalized = String(status || "PENDING").toUpperCase();
  statusElement.textContent = normalized;
  statusElement.className = `status-pill status-${normalized.toLowerCase().replace("_", "-")}`;
}

function renderQr(doc, order, isTerminalFailure) {
  const image = doc.querySelector("#qrisImage");
  const fallback = doc.querySelector("#qrFallback");
  const qrisBox = doc.querySelector("#qrisBox");
  const qrUrl = String(order.qr_url || "").trim();

  qrisBox?.classList.toggle("is-disabled", Boolean(isTerminalFailure));

  if (image) {
    image.hidden = true;
    image.removeAttribute("src");
  }

  if (!fallback) {
    return;
  }

  fallback.hidden = false;

  if (isTerminalFailure) {
    fallback.textContent = "QRIS sudah tidak aktif untuk order ini.";
    return;
  }

  if (!isValidQrUrl(qrUrl)) {
    fallback.textContent = "QRIS belum tersedia atau format QRIS tidak valid.";
    return;
  }

  if (image) {
    image.src = qrUrl;
    image.alt = `QRIS pembayaran untuk order ${order.order_id}`;
    image.hidden = false;
    fallback.hidden = true;
  }
}

function renderCheckoutUrl(doc, order, disabled) {
  const button = doc.querySelector("#openPaymentButton");
  const checkoutUrl = String(order.checkout_url || "").trim();
  const valid = !disabled && isValidCheckoutUrl(checkoutUrl);

  if (!button) {
    return;
  }

  if (valid) {
    button.href = checkoutUrl;
    button.setAttribute("aria-disabled", "false");
    button.classList.remove("button-disabled");
    return;
  }

  button.removeAttribute("href");
  button.setAttribute("aria-disabled", "true");
  button.classList.add("button-disabled");
}

function renderCountdown(doc, order, onExpired) {
  const countdownElement = doc.querySelector("#paymentCountdown");
  const expiryTimestamp = parseCashiExpiry(order.expires_at);

  if (!countdownElement) {
    return () => {};
  }

  if (!expiryTimestamp) {
    countdownElement.textContent = "Mengikuti status Cashi";
    return () => {};
  }

  function updateCountdown() {
    const remaining = expiryTimestamp - Date.now();

    if (remaining <= 0) {
      countdownElement.textContent = "Mengecek status pembayaran...";
      onExpired();
      return false;
    }

    countdownElement.textContent = formatCountdown(remaining);
    return true;
  }

  if (!updateCountdown()) {
    return () => {};
  }

  const intervalId = setInterval(() => {
    if (!updateCountdown()) {
      clearInterval(intervalId);
    }
  }, 1000);

  return () => clearInterval(intervalId);
}

function renderPayment(doc, order, options = {}) {
  const status = String(order.payment_status || "PENDING").toUpperCase();
  const paymentAmount = order.payment_amount ?? order.base_amount;
  const isTerminalFailure = status === "EXPIRED" || status === "PAYMENT_FAILED";

  setText(doc.querySelector("#paymentProduct"), order.product_name || "-");
  setText(doc.querySelector("#paymentQuantity"), `${Number(order.quantity || 1)} produk`);
  setText(doc.querySelector("#paymentOrderId"), order.order_id || "-");
  setText(doc.querySelector("#paymentBaseAmount"), formatRupiah(order.base_amount));
  setText(doc.querySelector("#paymentAmount"), formatRupiah(paymentAmount));
  setText(doc.querySelector("#paymentExpiry"), formatExpiry(order.expires_at));
  setPaymentStatus(doc.querySelector("#paymentStatus"), status);
  renderQr(doc, order, isTerminalFailure);
  renderCheckoutUrl(doc, order, isTerminalFailure);

  const newOrderButton = doc.querySelector("#newOrderButton");
  if (newOrderButton) {
    newOrderButton.hidden = status !== "EXPIRED" && status !== "PAYMENT_FAILED";
  }

  if (typeof options.onAfterRender === "function") {
    options.onAfterRender(order);
  }
}

function initPaymentPage(doc, win, orderId) {
  const orderFormView = doc.querySelector("#orderFormView");
  const checkoutInfo = doc.querySelector("#checkoutInfo");
  const paymentView = doc.querySelector("#paymentView");
  const paymentAlert = doc.querySelector("#paymentAlert");
  const copyAmountButton = doc.querySelector("#copyAmountButton");
  const openPaymentButton = doc.querySelector("#openPaymentButton");

  if (orderFormView) orderFormView.hidden = true;
  if (checkoutInfo) checkoutInfo.hidden = true;
  if (paymentView) paymentView.hidden = false;

  let latestOrder = null;
  let stopCountdown = () => {};

  const poller = createPaymentPollingController({
    documentRef: doc,
    getStatus: () =>
      fetchOrderStatus(orderId, {
        fetchImpl: win.fetch.bind(win)
      }),
    onStatus: (order) => {
      latestOrder = order;
      stopCountdown();
      renderPayment(doc, order);

      const status = String(order.payment_status || "PENDING").toUpperCase();

      if (status === "PAID") {
        setAlert(paymentAlert, "Pembayaran berhasil. Mengalihkan ke halaman sukses...", "info");
        win.location.replace(`/sukses.html?order_id=${encodeURIComponent(order.order_id)}`);
        return;
      }

      if (status === "EXPIRED") {
        setAlert(paymentAlert, "Waktu pembayaran telah habis.", "error");
        setText(doc.querySelector("#paymentCountdown"), "Waktu pembayaran telah habis");
        return;
      }

      if (status === "PAYMENT_FAILED") {
        setAlert(paymentAlert, "Pembayaran belum dapat dibuat. Silakan buat pesanan baru.", "error");
        setText(doc.querySelector("#paymentCountdown"), "-");
        return;
      }

      setAlert(paymentAlert, "Menunggu pembayaran. Kamu tidak perlu menutup halaman ini.", "info");
      stopCountdown = renderCountdown(doc, order, () => {
        void poller.checkNow();
      });
    },
    onError: () => {
      setAlert(
        paymentAlert,
        "Koneksi sedang tidak stabil. Kami akan mencoba memeriksa status lagi.",
        "info"
      );
    },
    onStop: (reason) => {
      if (reason === "timeout") {
        setAlert(paymentAlert, "Pengecekan otomatis berhenti sementara. Muat ulang halaman untuk cek lagi.", "info");
      }
    }
  });

  openPaymentButton?.addEventListener("click", (event) => {
    if (openPaymentButton.getAttribute("aria-disabled") === "true") {
      event.preventDefault();
    }
  });

  copyAmountButton?.addEventListener("click", async () => {
    if (!latestOrder) {
      setAlert(paymentAlert, "Nominal belum tersedia.", "error");
      return;
    }

    const amount = latestOrder.payment_amount ?? latestOrder.base_amount;

    try {
      await win.navigator.clipboard.writeText(String(amount));
      setAlert(paymentAlert, "Nominal berhasil disalin.", "info");
    } catch (error) {
      setAlert(paymentAlert, "Nominal belum bisa disalin otomatis.", "error");
    }
  });

  doc.addEventListener("visibilitychange", () => {
    if (doc.hidden) {
      poller.pause();
      return;
    }

    void poller.resume();
  });

  void poller.start({ immediate: true });
}

function initCheckoutPage(doc = document, win = window) {
  const params = new URLSearchParams(win.location.search);
  const orderId = String(params.get("order_id") || "").trim();

  if (orderId) {
    initPaymentPage(doc, win, orderId);
    return;
  }

  initCreateOrderForm(doc, win);
}

if (typeof document !== "undefined") {
  initCheckoutPage();
}

export {
  clearPendingClientRequestId,
  createOrder,
  createPaymentPollingController,
  fetchOrderStatus,
  formatRupiah,
  getClientRequestId,
  initCreateOrderForm,
  isValidCheckoutUrl,
  isValidQrUrl,
  parseCashiExpiry
};

