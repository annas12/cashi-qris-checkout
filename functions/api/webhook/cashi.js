const MAX_BODY_BYTES = 32768;
const WEBHOOK_EVENT = "PAYMENT_SETTLED";
const WEBHOOK_SETTLED_STATUS = "SETTLED";
const ORDER_ID_PATTERN = /^NF-\d{8}-[A-Z0-9]{6,16}$/;

const SECURITY_HEADERS = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer"
};

const encoder = new TextEncoder();

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

function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return bytesToHex(new Uint8Array(digest));
}

async function hmacSha256Hex(secret, rawBody) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    {
      name: "HMAC",
      hash: "SHA-256"
    },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(rawBody));

  return bytesToHex(new Uint8Array(signature));
}

async function timingSafeEqualText(left, right) {
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right))
  ]);
  const leftBytes = new Uint8Array(leftHash);
  const rightBytes = new Uint8Array(rightHash);
  let difference = leftBytes.length ^ rightBytes.length;

  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index] ^ rightBytes[index];
  }

  return difference === 0;
}

function normalizeSignature(value) {
  const signature = String(value || "").trim().toLowerCase();

  if (signature.startsWith("sha256=")) {
    return signature.slice("sha256=".length);
  }

  return signature;
}

async function verifySignature(rawBody, signatureHeader, secret) {
  const providedSignature = normalizeSignature(signatureHeader);

  if (!providedSignature) {
    return false;
  }

  const expectedSignature = await hmacSha256Hex(secret, rawBody);

  return timingSafeEqualText(providedSignature, expectedSignature);
}

function assertJsonRequest(request) {
  const contentType = request.headers.get("Content-Type") || "";

  if (!contentType.toLowerCase().includes("application/json")) {
    throw new HttpError(415, "Content-Type harus application/json.");
  }

  const contentLength = Number(request.headers.get("Content-Length") || "0");

  if (contentLength > MAX_BODY_BYTES) {
    throw new HttpError(413, "Ukuran request terlalu besar.");
  }
}

async function readRawBody(request) {
  const rawBody = await request.text();

  if (encoder.encode(rawBody).byteLength > MAX_BODY_BYTES) {
    throw new HttpError(413, "Ukuran request terlalu besar.");
  }

  return rawBody;
}

function parsePayload(rawBody) {
  try {
    return JSON.parse(rawBody);
  } catch (error) {
    throw new HttpError(400, "Payload webhook harus berupa JSON valid.");
  }
}

function validateOrderId(value) {
  const orderId = String(value || "").trim().toUpperCase();

  if (!ORDER_ID_PATTERN.test(orderId)) {
    throw new HttpError(400, "Format order_id tidak valid.");
  }

  return orderId;
}

function validatePaymentAmount(value) {
  const amount = Number(value);

  if (!Number.isInteger(amount) || amount <= 0) {
    throw new HttpError(400, "Amount webhook tidak valid.");
  }

  return amount;
}

function parseCashiTimestamp(value, options = {}) {
  const text = String(value || "").trim();

  if (!text) {
    return null;
  }

  const localMatch = text.match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/
  );
  let timestamp = null;

  if (localMatch) {
    const [, year, month, day, hour, minute, second = "00"] = localMatch;
    timestamp = Date.parse(`${year}-${month}-${day}T${hour}:${minute}:${second}+07:00`);
  } else {
    timestamp = Date.parse(text);
  }

  if (Number.isNaN(timestamp)) {
    return null;
  }

  const now = options.now ? options.now() : new Date();
  const minTimestamp = Date.parse("2020-01-01T00:00:00.000Z");
  const maxTimestamp = now.getTime() + 24 * 60 * 60 * 1000;

  if (timestamp < minTimestamp || timestamp > maxTimestamp) {
    return null;
  }

  return new Date(timestamp);
}

function formatJakartaTimestamp(date) {
  const jakartaTime = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  const year = jakartaTime.getUTCFullYear();
  const month = String(jakartaTime.getUTCMonth() + 1).padStart(2, "0");
  const day = String(jakartaTime.getUTCDate()).padStart(2, "0");
  const hour = String(jakartaTime.getUTCHours()).padStart(2, "0");
  const minute = String(jakartaTime.getUTCMinutes()).padStart(2, "0");
  const second = String(jakartaTime.getUTCSeconds()).padStart(2, "0");

  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

function normalizePaidAt(value, options = {}) {
  const parsed = parseCashiTimestamp(value, options);

  if (parsed) {
    return formatJakartaTimestamp(parsed);
  }

  return formatJakartaTimestamp(options.now ? options.now() : new Date());
}

function getEventName(payload) {
  return String(payload?.event || "").trim().toUpperCase();
}

function getEventOrderId(payload) {
  const value = payload?.data?.order_id;

  if (!value) {
    return null;
  }

  try {
    return validateOrderId(value);
  } catch (error) {
    return null;
  }
}

function getEventKey(payload, payloadHash) {
  const eventId = String(payload?.event_id || "").trim();

  if (/^[A-Za-z0-9._:-]{8,128}$/.test(eventId)) {
    return eventId;
  }

  return payloadHash;
}

function getRowsWritten(result) {
  const candidates = [
    result?.meta?.changes,
    result?.meta?.rows_written,
    result?.changes,
    result?.rows_written
  ];

  for (const value of candidates) {
    if (Number.isInteger(value)) {
      return value;
    }
  }

  return null;
}

function safeLog(message, details = {}) {
  console.log(JSON.stringify({
    message,
    event: details.event,
    order_id: details.order_id,
    result: details.result,
    payload_hash: details.payload_hash ? String(details.payload_hash).slice(0, 12) : undefined
  }));
}

async function findWebhookEvent(db, eventKey) {
  return db
    .prepare(
      `SELECT event_key,
              processing_status,
              response_code
       FROM webhook_events
       WHERE event_key = ?`
    )
    .bind(eventKey)
    .first();
}

async function insertWebhookEvent(db, event) {
  try {
    await db
      .prepare(
        `INSERT INTO webhook_events (
          event_key,
          event_name,
          order_id,
          payload_hash,
          processing_status,
          response_code
        ) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(
        event.event_key,
        event.event_name,
        event.order_id,
        event.payload_hash,
        "RECEIVED",
        null
      )
      .run();

    return true;
  } catch (error) {
    return false;
  }
}

async function updateWebhookEvent(db, eventKey, processingStatus, responseCode, options = {}) {
  const processedAt = (options.now ? options.now() : new Date()).toISOString();

  await db
    .prepare(
      `UPDATE webhook_events
       SET processing_status = ?,
           processed_at = ?,
           response_code = ?
       WHERE event_key = ?`
    )
    .bind(processingStatus, processedAt, responseCode, eventKey)
    .run();
}

async function findOrder(db, orderId) {
  return db
    .prepare(
      `SELECT order_id,
              payment_amount,
              payment_status
       FROM orders
       WHERE order_id = ?`
    )
    .bind(orderId)
    .first();
}

async function markOrderPaid(db, orderId, amount, paidAt) {
  const result = await db
    .prepare(
      `UPDATE orders
       SET payment_status = ?,
           paid_at = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE order_id = ?
         AND payment_status = ?
         AND payment_amount = ?`
    )
    .bind("PAID", paidAt, orderId, "PENDING", amount)
    .run();

  return getRowsWritten(result);
}

async function rejectEvent(db, eventKey, responseCode, message, logDetails, options = {}) {
  await updateWebhookEvent(db, eventKey, "REJECTED", responseCode, options);
  safeLog("Cashi webhook rejected", {
    ...logDetails,
    result: "REJECTED"
  });

  return json({ success: false, message }, responseCode);
}

async function processSettledEvent(context, state, options = {}) {
  const { payload, eventKey, payloadHash } = state;
  const data = payload.data || {};
  let orderId = null;
  let amount = null;
  const status = String(data.status || "").trim().toUpperCase();

  try {
    orderId = validateOrderId(data.order_id);
    amount = validatePaymentAmount(data.amount);
  } catch (error) {
    return rejectEvent(
      context.env.DB,
      eventKey,
      error instanceof HttpError ? error.status : 400,
      error instanceof HttpError ? error.message : "Payload webhook belum valid.",
      {
        event: WEBHOOK_EVENT,
        order_id: orderId,
        payload_hash: payloadHash
      },
      options
    );
  }

  const logDetails = {
    event: WEBHOOK_EVENT,
    order_id: orderId,
    payload_hash: payloadHash
  };

  if (status !== WEBHOOK_SETTLED_STATUS) {
    return rejectEvent(context.env.DB, eventKey, 400, "Invalid payment status", logDetails, options);
  }

  const order = await findOrder(context.env.DB, orderId);

  if (!order) {
    return rejectEvent(context.env.DB, eventKey, 404, "Order not found", logDetails, options);
  }

  if (Number(order.payment_amount) !== amount) {
    return rejectEvent(context.env.DB, eventKey, 409, "Payment amount mismatch", logDetails, options);
  }

  const orderStatus = String(order.payment_status || "").trim().toUpperCase();

  if (orderStatus === "PAID") {
    await updateWebhookEvent(context.env.DB, eventKey, "PROCESSED", 200, options);
    safeLog("Cashi webhook processed", { ...logDetails, result: "ALREADY_PAID" });

    return json({ success: true });
  }

  if (orderStatus === "EXPIRED" || orderStatus === "PAYMENT_FAILED") {
    return rejectEvent(
      context.env.DB,
      eventKey,
      409,
      "Order status does not allow payment update",
      {
        ...logDetails,
        result: orderStatus
      },
      options
    );
  }

  if (orderStatus !== "PENDING") {
    return rejectEvent(context.env.DB, eventKey, 409, "Order status does not allow payment update", logDetails, options);
  }

  const paidAt = normalizePaidAt(data.paid_at, options);
  const rowsWritten = await markOrderPaid(context.env.DB, orderId, amount, paidAt);

  if (rowsWritten === 0) {
    const latestOrder = await findOrder(context.env.DB, orderId);
    const latestStatus = String(latestOrder?.payment_status || "").trim().toUpperCase();

    if (latestStatus === "PAID") {
      await updateWebhookEvent(context.env.DB, eventKey, "PROCESSED", 200, options);
      safeLog("Cashi webhook processed", { ...logDetails, result: "ALREADY_PAID" });

      return json({ success: true });
    }

    return rejectEvent(context.env.DB, eventKey, 409, "Order was not updated", logDetails, options);
  }

  await updateWebhookEvent(context.env.DB, eventKey, "PROCESSED", 200, options);
  safeLog("Cashi webhook processed", { ...logDetails, result: "PAID" });

  return json({ success: true });
}

async function handleCashiWebhook(context, options = {}) {
  try {
    if (context.request.method !== "POST") {
      return json({ success: false, message: "Gunakan metode POST untuk webhook Cashi." }, 405);
    }

    assertJsonRequest(context.request);

    if (!context.env.CASHI_WEBHOOK_SECRET) {
      return json({ success: false, message: "Webhook secret is not configured." }, 500);
    }

    const signatureHeader = context.request.headers.get("x-gateway-signature");

    if (!signatureHeader) {
      return json({ success: false, message: "Invalid signature" }, 401);
    }

    const rawBody = await readRawBody(context.request);
    const isValidSignature = await verifySignature(
      rawBody,
      signatureHeader,
      context.env.CASHI_WEBHOOK_SECRET
    );

    if (!isValidSignature) {
      return json({ success: false, message: "Invalid signature" }, 401);
    }

    if (!context.env.DB) {
      return json({ success: false, message: "Konfigurasi server belum siap." }, 500);
    }

    const payloadHash = await sha256Hex(rawBody);
    const payload = parsePayload(rawBody);
    const eventName = getEventName(payload);

    if (!eventName) {
      throw new HttpError(400, "Event webhook wajib diisi.");
    }

    const eventKey = getEventKey(payload, payloadHash);
    const existingEvent = await findWebhookEvent(context.env.DB, eventKey);

    if (existingEvent?.processing_status === "PROCESSED") {
      return json({ success: true });
    }

    const orderId = getEventOrderId(payload);

    if (!existingEvent) {
      await insertWebhookEvent(context.env.DB, {
        event_key: eventKey,
        event_name: eventName,
        order_id: orderId,
        payload_hash: payloadHash
      });
    }

    if (eventName !== WEBHOOK_EVENT) {
      await updateWebhookEvent(context.env.DB, eventKey, "PROCESSED", 200, options);
      safeLog("Cashi webhook ignored", {
        event: eventName,
        order_id: orderId,
        result: "IGNORED",
        payload_hash: payloadHash
      });

      return json({ success: true });
    }

    return processSettledEvent(context, { payload, eventKey, payloadHash }, options);
  } catch (error) {
    if (error instanceof HttpError) {
      return json({ success: false, message: error.message }, error.status);
    }

    safeLog("Cashi webhook failed", { result: "UNEXPECTED_ERROR" });
    return json({ success: false, message: "Webhook belum dapat diproses." }, 500);
  }
}

export async function onRequest(context) {
  return handleCashiWebhook(context);
}

export {
  formatJakartaTimestamp,
  handleCashiWebhook,
  hmacSha256Hex,
  normalizePaidAt,
  normalizeSignature,
  sha256Hex,
  validateOrderId,
  verifySignature
};
