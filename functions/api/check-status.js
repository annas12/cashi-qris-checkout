const SUPPORTED_STATUSES = new Set(["PENDING", "PAID", "PAYMENT_FAILED", "EXPIRED"]);

const SECURITY_HEADERS = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer"
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: SECURITY_HEADERS
  });
}

function normalizeStatus(value) {
  const status = String(value || "PENDING").trim().toUpperCase();
  return SUPPORTED_STATUSES.has(status) ? status : "PENDING";
}

function validateOrderId(value) {
  const orderId = String(value || "").trim().toUpperCase();

  if (!orderId) {
    throw new HttpError(400, "Parameter order_id wajib diisi.");
  }

  if (!/^NF-\d{8}-[A-Z0-9]{6,16}$/.test(orderId)) {
    throw new HttpError(400, "Format order_id tidak valid.");
  }

  return orderId;
}

function parseCashiExpiry(value) {
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

function getNow(options = {}) {
  if (options.now instanceof Date) {
    return options.now;
  }

  if (typeof options.now === "function") {
    return options.now();
  }

  return new Date();
}

function isPastExpiry(order, now) {
  const expiryTimestamp = parseCashiExpiry(order.expires_at);

  if (!expiryTimestamp) {
    return false;
  }

  return now.getTime() >= expiryTimestamp;
}

async function findOrder(db, orderId) {
  return db
    .prepare(
      `SELECT order_id,
              product_name,
              quantity,
              base_amount,
              payment_amount,
              payment_status,
              checkout_url,
              qr_url,
              expires_at,
              paid_at
       FROM orders
       WHERE order_id = ?`
    )
    .bind(orderId)
    .first();
}

async function markExpired(db, orderId, now) {
  await db
    .prepare(
      `UPDATE orders
       SET payment_status = ?,
           updated_at = ?
       WHERE order_id = ?
         AND payment_status = ?`
    )
    .bind("EXPIRED", now.toISOString(), orderId, "PENDING")
    .run();
}

function toPublicOrder(order) {
  return {
    success: true,
    order_id: order.order_id,
    product_name: order.product_name,
    quantity: Number(order.quantity || 1),
    base_amount: Number(order.base_amount || 0),
    payment_amount: order.payment_amount == null ? null : Number(order.payment_amount),
    payment_status: normalizeStatus(order.payment_status),
    checkout_url: order.checkout_url || null,
    qr_url: order.qr_url || null,
    expires_at: order.expires_at || null,
    paid_at: order.paid_at || null
  };
}

async function handleCheckStatus(context, options = {}) {
  try {
    if (!context.env.DB) {
      throw new HttpError(500, "Konfigurasi server belum siap.");
    }

    const url = new URL(context.request.url);
    const orderId = validateOrderId(url.searchParams.get("order_id"));
    const order = await findOrder(context.env.DB, orderId);

    if (!order) {
      return json({ success: false, message: "Order tidak ditemukan." }, 404);
    }

    const now = getNow(options);
    const status = normalizeStatus(order.payment_status);
    const publicOrder = toPublicOrder({ ...order, payment_status: status });

    if (status === "PENDING" && isPastExpiry(publicOrder, now)) {
      await markExpired(context.env.DB, orderId, now);
      publicOrder.payment_status = "EXPIRED";
    }

    return json(publicOrder);
  } catch (error) {
    if (error instanceof HttpError) {
      return json({ success: false, message: error.message }, error.status);
    }

    console.error("Check status failed", { reason: "unexpected_error" });
    return json({ success: false, message: "Status order belum dapat diperiksa." }, 500);
  }
}

export async function onRequestGet(context) {
  return handleCheckStatus(context);
}

export function onRequestPost() {
  return json({ success: false, message: "Gunakan metode GET untuk cek status." }, 405);
}

export function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: SECURITY_HEADERS
  });
}

export {
  handleCheckStatus,
  isPastExpiry,
  normalizeStatus,
  parseCashiExpiry,
  validateOrderId
};
