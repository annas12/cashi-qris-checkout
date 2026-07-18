const FETCH_TIMEOUT_MS = 8000;

const currencyFormatter = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0
});

const dateFormatter = new Intl.DateTimeFormat("id-ID", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Jakarta"
});

function formatRupiah(amount) {
  const value = Number(amount);
  const safeAmount = Number.isFinite(value) ? value : 0;
  return currencyFormatter.format(safeAmount).replace(/\s+/g, "");
}

function parseDateTime(value) {
  const text = String(value || "").trim();

  if (!text) {
    return null;
  }

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

function formatDateTime(value) {
  const timestamp = parseDateTime(value);

  if (!timestamp) {
    return value ? String(value) : "-";
  }

  return `${dateFormatter.format(timestamp)} WIB`;
}

async function fetchWithTimeout(url, init = {}, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const timeoutMs = options.timeoutMs || FETCH_TIMEOUT_MS;
  controller = new AbortController();
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

function getSuccessDecision(orderId, order) {
  if (!orderId) {
    return {
      action: "message",
      tone: "failed",
      title: "Order tidak valid",
      message: "Nomor order tidak tersedia."
    };
  }

  const status = String(order?.payment_status || "").toUpperCase();

  if (status === "PAID") {
    return {
      action: "show",
      tone: "success",
      title: "Pembayaran berhasil",
      message: "Terima kasih, pembayaran kamu sudah tercatat."
    };
  }

  if (status === "PENDING") {
    return {
      action: "redirect",
      target: `/checkout.html?order_id=${encodeURIComponent(orderId)}`
    };
  }

  if (status === "EXPIRED") {
    return {
      action: "message",
      tone: "failed",
      title: "Waktu pembayaran telah habis",
      message: "Silakan buat pesanan baru untuk mendapatkan QRIS baru."
    };
  }

  if (status === "PAYMENT_FAILED") {
    return {
      action: "message",
      tone: "failed",
      title: "Pembayaran belum dapat dibuat",
      message: "Silakan buat pesanan baru."
    };
  }

  return {
    action: "message",
    tone: "failed",
    title: "Status belum dapat dikonfirmasi",
    message: "Silakan kembali ke halaman checkout untuk memeriksa ulang."
  };
}

function setText(element, value) {
  if (element) {
    element.textContent = value;
  }
}

function renderSuccess(doc, order, decision) {
  const statusBox = doc.querySelector(".status-box");
  const details = doc.querySelector("#successDetails");

  statusBox?.classList.toggle("success", decision.tone === "success");
  statusBox?.classList.toggle("failed", decision.tone === "failed");
  setText(doc.querySelector("#successTitle"), decision.title);
  setText(doc.querySelector("#successMessage"), decision.message);

  if (decision.action !== "show") {
    if (details) details.hidden = true;
    return;
  }

  if (details) details.hidden = false;
  setText(doc.querySelector("#successOrderId"), order.order_id || "-");
  setText(doc.querySelector("#successProduct"), order.product_name || "-");
  setText(doc.querySelector("#successQuantity"), `${Number(order.quantity || 1)} produk`);
  setText(doc.querySelector("#successAmount"), formatRupiah(order.payment_amount ?? order.base_amount));
  setText(doc.querySelector("#successPaidAt"), formatDateTime(order.paid_at));
}

async function initSuccessPage(doc = document, win = window) {
  const params = new URLSearchParams(win.location.search);
  const orderId = String(params.get("order_id") || "").trim();

  try {
    const order = orderId
      ? await fetchOrderStatus(orderId, {
          fetchImpl: win.fetch.bind(win)
        })
      : null;
    const decision = getSuccessDecision(orderId, order);

    if (decision.action === "redirect") {
      win.location.replace(decision.target);
      return;
    }

    renderSuccess(doc, order, decision);
  } catch (error) {
    renderSuccess(doc, null, {
      action: "message",
      tone: "failed",
      title: "Status belum dapat dikonfirmasi",
      message: "Silakan kembali ke halaman checkout untuk memeriksa ulang."
    });
  }
}

if (typeof document !== "undefined") {
  void initSuccessPage();
}

export {
  fetchOrderStatus,
  formatDateTime,
  formatRupiah,
  getSuccessDecision
};
