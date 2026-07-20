const CASHI_CREATE_ORDER_URL = "https://cashi.id/api/create-order";
const MAX_BODY_BYTES = 8192;
const MAX_ORDER_ID_RETRIES = 5;
const CASHI_TIMEOUT_MS = 10000;
const MAX_CASHI_PAYLOAD_BYTES = 8000;

const PRODUCT_CATALOG = {
  "NF-1": {
    product_name: "Nutriflakes 1 Box",
    quantity: 1,
    amount: 5000
  },
  "NF-2": {
    product_name: "Nutriflakes 2 Box",
    quantity: 2,
    amount: 190000
  },
  "NF-3": {
    product_name: "Nutriflakes 3 Box",
    quantity: 3,
    amount: 276000
  }
};

const SECURITY_HEADERS = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "geolocation=(), microphone=(), camera=()"
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function getOriginHeaders(request, env) {
  const origin = request.headers.get("Origin");
  const allowedOrigin = String(env.ALLOWED_ORIGIN || "").trim();
  let requestOrigin = "";

  try {
    requestOrigin = new URL(request.url).origin;
  } catch (error) {
    requestOrigin = "";
  }

  if (!origin) {
    return { allowed: true, headers: {} };
  }

  if (origin !== requestOrigin && origin !== allowedOrigin) {
    return { allowed: false, headers: {} };
  }

  return {
    allowed: true,
    headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin"
    }
  };
}

function json(context, data, status = 200) {
  const cors = getOriginHeaders(context.request, context.env || {});
  const headers = {
    ...SECURITY_HEADERS,
    ...cors.headers
  };

  return new Response(JSON.stringify(data), {
    status,
    headers
  });
}

function safeLog(message, details = {}) {
  console.error(message, {
    order_id: details.order_id,
    status: details.status,
    reason: details.reason,
    api_key_present: details.api_key_present,
    api_key_length: details.api_key_length,
    api_key_prefix: details.api_key_prefix,
    api_key_suffix: details.api_key_suffix,
    request_amount: details.request_amount,
    request_order_id: details.request_order_id,
    request_url: details.request_url,
    response_content_type: details.response_content_type,
    response_body: details.response_body
  });
}

function assertAllowedOrigin(context) {
  const cors = getOriginHeaders(context.request, context.env || {});

  if (!cors.allowed) {
    throw new HttpError(403, "Origin tidak diizinkan.");
  }
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

async function readJsonBody(request) {
  const rawBody = await request.text();

  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
    throw new HttpError(413, "Ukuran request terlalu besar.");
  }

  try {
    return JSON.parse(rawBody);
  } catch (error) {
    throw new HttpError(400, "Body harus berupa JSON yang valid.");
  }
}

function normalizePhone(value) {
  const cleaned = String(value || "").replace(/[^\d+]/g, "");
  let phone = cleaned;

  if (phone.startsWith("+62")) {
    phone = phone.slice(1);
  } else if (phone.startsWith("0")) {
    phone = `62${phone.slice(1)}`;
  }

  return phone;
}

function normalizeProductCode(value) {
  return String(value || "").trim().toUpperCase();
}

function unwrapApiKeyQuotes(value) {
  const text = String(value || "").trim();

  if (text.length >= 2) {
    const first = text[0];
    const last = text[text.length - 1];

    if ((first === "\"" && last === "\"") || (first === "'" && last === "'")) {
      return text.slice(1, -1).trim();
    }
  }

  return text;
}

function normalizeCashiApiKey(value) {
  let apiKey = unwrapApiKeyQuotes(value);

  if (/^x-api-key\s*:/i.test(apiKey)) {
    apiKey = apiKey.replace(/^x-api-key\s*:/i, "").trim();
    apiKey = unwrapApiKeyQuotes(apiKey);
  }

  return apiKey;
}

function getApiKeyDiagnostics(apiKey) {
  return {
    api_key_present: apiKey.length > 0,
    api_key_length: apiKey.length,
    api_key_prefix: apiKey.slice(0, 4),
    api_key_suffix: apiKey.slice(-4)
  };
}

function validateClientRequestId(value) {
  const clientRequestId = String(value || "").trim();

  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(clientRequestId)) {
    return null;
  }

  return clientRequestId;
}

function validateOrderPayload(payload) {
  const customerName = String(payload.customer_name ?? payload.fullName ?? "").trim();
  const phone = normalizePhone(payload.phone ?? payload.whatsapp);
  const address = String(payload.address || "").trim();
  const productCode = normalizeProductCode(payload.product_code ?? payload.packageId);
  const clientRequestId = validateClientRequestId(payload.client_request_id);
  const product = PRODUCT_CATALOG[productCode];
  const errors = {};

  if (customerName.length < 2 || customerName.length > 100) {
    errors.customer_name = "Nama pembeli harus 2 sampai 100 karakter.";
  }

  if (!/^628\d{8,12}$/.test(phone)) {
    errors.phone = "Nomor HP Indonesia tidak valid.";
  }

  if (address.length < 5 || address.length > 500) {
    errors.address = "Alamat harus 5 sampai 500 karakter.";
  }

  if (!product) {
    errors.product_code = "Produk tidak tersedia.";
  }

  if (!clientRequestId) {
    errors.client_request_id = "client_request_id tidak valid.";
  }

  if (Object.keys(errors).length > 0) {
    throw new HttpError(400, "Data pesanan belum valid.");
  }

  return {
    customerName,
    phone,
    address,
    productCode,
    clientRequestId,
    product
  };
}

function getDateStamp(now = new Date()) {
  const jakartaTime = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const year = jakartaTime.getUTCFullYear();
  const month = String(jakartaTime.getUTCMonth() + 1).padStart(2, "0");
  const day = String(jakartaTime.getUTCDate()).padStart(2, "0");

  return `${year}${month}${day}`;
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

function createRandomSuffix(randomSource = crypto) {
  if (randomSource.randomUUID) {
    return randomSource.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
  }

  const bytes = new Uint8Array(4);
  randomSource.getRandomValues(bytes);

  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
}

function createOrderId(options = {}) {
  const now = options.now ? options.now() : new Date();
  const randomSource = options.randomSource || crypto;

  return `NF-${getDateStamp(now)}-${createRandomSuffix(randomSource)}`;
}

async function findOrderByClientRequestId(db, clientRequestId) {
  return db
    .prepare(
      `SELECT order_id, customer_name, phone, address, product_code, product_name, quantity,
              base_amount, payment_amount, payment_status, checkout_url, qr_url, expires_at,
              client_request_id, created_at, updated_at
       FROM orders
       WHERE client_request_id = ?`
    )
    .bind(clientRequestId)
    .first();
}

async function insertPendingOrder(db, orderData, options = {}) {
  let lastError;

  for (let attempt = 0; attempt < MAX_ORDER_ID_RETRIES; attempt += 1) {
    const orderId = createOrderId(options);
    const createdAt = new Date().toISOString();

    try {
      await db
        .prepare(
          `INSERT INTO orders (
            order_id,
            client_request_id,
            customer_name,
            phone,
            address,
            product_code,
            product_name,
            quantity,
            base_amount,
            payment_status,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          orderId,
          orderData.clientRequestId,
          orderData.customerName,
          orderData.phone,
          orderData.address,
          orderData.productCode,
          orderData.product.product_name,
          orderData.product.quantity,
          orderData.product.amount,
          "PENDING",
          createdAt,
          createdAt
        )
        .run();

      return {
        order_id: orderId,
        client_request_id: orderData.clientRequestId,
        customer_name: orderData.customerName,
        phone: orderData.phone,
        address: orderData.address,
        product_code: orderData.productCode,
        product_name: orderData.product.product_name,
        quantity: orderData.product.quantity,
        base_amount: orderData.product.amount,
        payment_status: "PENDING",
        created_at: createdAt,
        updated_at: createdAt
      };
    } catch (error) {
      lastError = error;
      const existing = await findOrderByClientRequestId(db, orderData.clientRequestId);

      if (existing) {
        return existing;
      }
    }
  }

  throw lastError || new Error("Unable to create unique order ID");
}

function normalizeCashiResponse(payload) {
  const amount = Number(payload.amount);

  return {
    order_id: payload.order_id || payload.orderId || null,
    provider_order_id: payload.provider_order_id || payload.providerOrderId || null,
    amount: Number.isFinite(amount) ? amount : null,
    checkout_url: payload.checkout_url || payload.checkoutUrl || null,
    qr_url: payload.qrUrl || payload.qr_url || null,
    qr_string: payload.qr_string || payload.qrString || null,
    expires_at: payload.expires_at || null
  };
}

function serializeCashiPayload(payload) {
  const serialized = JSON.stringify(payload);

  if (new TextEncoder().encode(serialized).byteLength <= MAX_CASHI_PAYLOAD_BYTES) {
    return serialized;
  }

  return serialized.slice(0, MAX_CASHI_PAYLOAD_BYTES);
}

function isCompletedPayment(order) {
  return Boolean(order.payment_amount || order.checkout_url || order.qr_url);
}

function isPaymentFailed(order) {
  return String(order?.payment_status || "").trim().toUpperCase() === "PAYMENT_FAILED";
}

function toFrontendResponse(order) {
  return {
    success: true,
    order_id: order.order_id,
    product_name: order.product_name,
    quantity: order.quantity,
    base_amount: order.base_amount,
    payment_amount: order.payment_amount,
    checkout_url: order.checkout_url,
    qr_url: order.qr_url,
    expires_at: order.expires_at
  };
}

async function mockCashiResponse(order, env) {
  if (env.CASHI_MOCK_MODE === "failure") {
    throw new Error("Mock Cashi failure");
  }

  if (env.CASHI_MOCK_MODE === "success") {
    return {
      success: true,
      order_id: order.order_id,
      amount: order.base_amount + 23,
      checkout_url: `https://cashi.id/pay/${order.order_id}`,
      qrUrl: "data:image/png;base64,iVBORw0KGgo=",
      expires_at: formatJakartaTimestamp(new Date(Date.now() + 15 * 60 * 1000))
    };
  }

  return null;
}

function truncateText(value, maxLength = 1000) {
  const text = String(value || "");

  if (!text) {
    return "<empty response body>";
  }

  if (text.length <= maxLength) {
    return text;
  }

  return text.slice(0, maxLength);
}

async function readCashiResponseText(response) {
  try {
    return await response.text();
  } catch (error) {
    return "<unable to read response body>";
  }
}

function createCashiError(message, details) {
  const error = new Error(message);
  Object.assign(error, details);
  return error;
}

function buildCashiRequest(order, normalizedApiKey) {
  return {
    url: CASHI_CREATE_ORDER_URL,
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "x-api-key": normalizedApiKey
    },
    payload: {
      amount: Number(order.base_amount),
      order_id: String(order.order_id)
    }
  };
}

async function callCashi(order, env, options = {}) {
  const mocked = await mockCashiResponse(order, env);

  if (mocked) {
    return mocked;
  }

  const normalizedApiKey = normalizeCashiApiKey(env.CASHI_API_KEY);
  const requestConfig = buildCashiRequest(order, normalizedApiKey);
  const diagnostics = {
    ...getApiKeyDiagnostics(normalizedApiKey),
    request_amount: requestConfig.payload.amount,
    request_order_id: requestConfig.payload.order_id,
    request_url: requestConfig.url
  };

  if (!normalizedApiKey) {
    throw createCashiError("Cashi API key is not configured", diagnostics);
  }

  const fetchImpl = options.fetchImpl || fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CASHI_TIMEOUT_MS);

  try {
    const response = await fetchImpl(requestConfig.url, {
      method: "POST",
      headers: requestConfig.headers,
      body: JSON.stringify(requestConfig.payload),
      signal: controller.signal
    });
    const responseContentType = response.headers.get("Content-Type") || "<no content-type>";

    if (!response.ok) {
      const responseText = await readCashiResponseText(response);

      throw createCashiError("Cashi returned a non-2xx response", {
        ...diagnostics,
        status: response.status,
        response_content_type: responseContentType,
        response_body: truncateText(responseText)
      });
    }

    const responseText = await readCashiResponseText(response);
    let payload;

    try {
      payload = JSON.parse(responseText);
    } catch (error) {
      throw createCashiError("Cashi response was not valid JSON", {
        ...diagnostics,
        status: response.status,
        response_content_type: responseContentType,
        response_body: truncateText(responseText)
      });
    }

    if (!payload || payload.success !== true) {
      throw createCashiError("Cashi response was not successful", {
        ...diagnostics,
        status: response.status,
        response_content_type: responseContentType,
        response_body: truncateText(responseText)
      });
    }

    return payload;
  } catch (error) {
    if (error?.request_url) {
      throw error;
    }

    throw createCashiError(error instanceof Error ? error.message : "Cashi request failed", {
      ...diagnostics,
      status: error?.name === "AbortError" ? "timeout" : "request_failed",
      response_content_type: "<no content-type>",
      response_body: "<empty response body>"
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function updateOrderWithCashiSuccess(db, order, cashiPayload) {
  const normalized = normalizeCashiResponse(cashiPayload);
  const updatedAt = new Date().toISOString();
  const paymentAmount = normalized.amount ?? order.base_amount;

  await db
    .prepare(
      `UPDATE orders
       SET payment_amount = ?,
           checkout_url = ?,
           qr_url = ?,
           expires_at = ?,
           cashi_payload = ?,
           updated_at = ?
       WHERE order_id = ?`
    )
    .bind(
      paymentAmount,
      normalized.checkout_url,
      normalized.qr_url,
      normalized.expires_at,
      serializeCashiPayload(cashiPayload),
      updatedAt,
      order.order_id
    )
    .run();

  return {
    ...order,
    payment_amount: paymentAmount,
    checkout_url: normalized.checkout_url,
    qr_url: normalized.qr_url,
    expires_at: normalized.expires_at,
    cashi_payload: serializeCashiPayload(cashiPayload),
    updated_at: updatedAt
  };
}

async function updateOrderWithCashiFailure(db, order) {
  await db
    .prepare(
      `UPDATE orders
       SET payment_status = ?,
           updated_at = ?
       WHERE order_id = ?`
    )
    .bind("PAYMENT_FAILED", new Date().toISOString(), order.order_id)
    .run();
}

export async function handleCreateOrder(context, options = {}) {
  try {
    assertAllowedOrigin(context);
    assertJsonRequest(context.request);

    if (!context.env.DB) {
      throw new HttpError(500, "Konfigurasi server belum siap.");
    }

    const payload = await readJsonBody(context.request);
    const orderData = validateOrderPayload(payload);
    const existing = await findOrderByClientRequestId(context.env.DB, orderData.clientRequestId);

    if (existing && isPaymentFailed(existing)) {
      return json(
        context,
        { message: "Pembayaran sebelumnya gagal. Silakan coba kembali." },
        409
      );
    }

    const order = existing || (await insertPendingOrder(context.env.DB, orderData, options));

    if (isCompletedPayment(order)) {
      return json(context, toFrontendResponse(order));
    }

    let cashiPayload;

    try {
      cashiPayload = await callCashi(order, context.env, options);
    } catch (error) {
      await updateOrderWithCashiFailure(context.env.DB, order);
      safeLog("Cashi create order failed", {
        order_id: order.order_id,
        status: error.status || "request_failed",
        reason: "payment_create_failed",
        api_key_present: error.api_key_present,
        api_key_length: error.api_key_length,
        api_key_prefix: error.api_key_prefix,
        api_key_suffix: error.api_key_suffix,
        request_amount: error.request_amount,
        request_order_id: error.request_order_id,
        request_url: error.request_url,
        response_content_type: error.response_content_type,
        response_body: error.response_body
      });

      return json(
        context,
        { message: "Pembayaran belum dapat dibuat. Silakan coba kembali." },
        502
      );
    }

    const updatedOrder = await updateOrderWithCashiSuccess(context.env.DB, order, cashiPayload);

    return json(context, toFrontendResponse(updatedOrder), 201);
  } catch (error) {
    if (error instanceof HttpError) {
      return json(context, { message: error.message }, error.status);
    }

    safeLog("Create order failed", { reason: "unexpected_error" });
    return json(context, { message: "Pesanan belum dapat dibuat." }, 500);
  }
}

export async function onRequestPost(context) {
  return handleCreateOrder(context);
}

export function onRequestOptions(context) {
  const cors = getOriginHeaders(context.request, context.env || {});

  if (!cors.allowed) {
    return json(context, { message: "Origin tidak diizinkan." }, 403);
  }

  return new Response(null, {
    status: 204,
    headers: {
      ...SECURITY_HEADERS,
      ...cors.headers
    }
  });
}

export function onRequestGet(context) {
  return json(context, { message: "Gunakan metode POST untuk membuat order." }, 405);
}

export {
  PRODUCT_CATALOG,
  normalizeCashiApiKey,
  normalizeCashiResponse,
  normalizePhone,
  validateOrderPayload
};
