import assert from "node:assert/strict";
import {
  handleCreateOrder,
  normalizeCashiApiKey
} from "../functions/api/create-order.js";

class FakeStatement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.params = [];
  }

  bind(...params) {
    this.params = params;
    return this;
  }

  async first() {
    if (this.sql.includes("WHERE client_request_id = ?")) {
      const clientRequestId = this.params[0];
      const order = this.db.orders.find((item) => item.client_request_id === clientRequestId);
      return order ? { ...order } : null;
    }

    throw new Error(`Unhandled first SQL: ${this.sql}`);
  }

  async run() {
    if (this.sql.includes("INSERT INTO orders")) {
      const [
        orderId,
        clientRequestId,
        customerName,
        phone,
        address,
        productCode,
        productName,
        quantity,
        baseAmount,
        paymentStatus,
        createdAt,
        updatedAt
      ] = this.params;

      if (this.db.orders.some((order) => order.order_id === orderId)) {
        throw new Error("UNIQUE constraint failed: orders.order_id");
      }

      if (this.db.orders.some((order) => order.client_request_id === clientRequestId)) {
        throw new Error("UNIQUE constraint failed: orders.client_request_id");
      }

      this.db.orders.push({
        order_id: orderId,
        client_request_id: clientRequestId,
        customer_name: customerName,
        phone,
        address,
        product_code: productCode,
        product_name: productName,
        quantity,
        base_amount: baseAmount,
        payment_amount: null,
        payment_status: paymentStatus,
        checkout_url: null,
        qr_url: null,
        expires_at: null,
        cashi_payload: null,
        created_at: createdAt,
        updated_at: updatedAt
      });

      return { success: true };
    }

    if (this.sql.includes("SET payment_amount = ?")) {
      const [paymentAmount, checkoutUrl, qrUrl, expiresAt, cashiPayload, updatedAt, orderId] = this.params;
      const order = this.db.orders.find((item) => item.order_id === orderId);
      assert.ok(order, "success update target order exists");
      Object.assign(order, {
        payment_amount: paymentAmount,
        checkout_url: checkoutUrl,
        qr_url: qrUrl,
        expires_at: expiresAt,
        cashi_payload: cashiPayload,
        updated_at: updatedAt
      });

      return { success: true };
    }

    if (this.sql.includes("SET payment_status = ?")) {
      const [paymentStatus, updatedAt, orderId] = this.params;
      const order = this.db.orders.find((item) => item.order_id === orderId);
      assert.ok(order, "failure update target order exists");
      Object.assign(order, {
        payment_status: paymentStatus,
        updated_at: updatedAt
      });

      return { success: true };
    }

    throw new Error(`Unhandled run SQL: ${this.sql}`);
  }
}

class FakeDB {
  constructor(orders = []) {
    this.orders = orders.map((order) => ({ ...order }));
  }

  prepare(sql) {
    return new FakeStatement(this, sql);
  }
}

const baseEnv = {
  CASHI_API_KEY: "test_api_key",
  ALLOWED_ORIGIN: "https://checkout.example"
};

const validPayload = {
  customer_name: "Budi Santoso",
  phone: "081234567890",
  address: "Jl. Melati No. 10",
  product_code: "NF-1",
  client_request_id: "req_123456789"
};

function createStoredOrder(overrides = {}) {
  return {
    order_id: "NF-20260718-EXIST1",
    client_request_id: validPayload.client_request_id,
    customer_name: "Budi Santoso",
    phone: "6281234567890",
    address: "Jl. Melati No. 10",
    product_code: "NF-1",
    product_name: "Nutriflakes 1 Box",
    quantity: 1,
    base_amount: 95000,
    payment_amount: null,
    payment_status: "PENDING",
    checkout_url: null,
    qr_url: null,
    expires_at: null,
    cashi_payload: null,
    created_at: "2026-07-18T01:00:00.000Z",
    updated_at: "2026-07-18T01:00:00.000Z",
    ...overrides
  };
}

function createRequest(body, options = {}) {
  const headers = new Headers(options.headers || {});

  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  if (options.origin) {
    headers.set("Origin", options.origin);
  }

  return new Request("https://checkout.example/api/create-order", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body)
  });
}

function createSuccessFetch(assertion = () => {}, responsePayload = null) {
  let calls = 0;
  const payload = responsePayload || {
    success: true,
    order_id: "INV-9921",
    amount: 95023,
    checkout_url: "https://cashi.id/pay/INV-9921",
    qrUrl: "data:image/png;base64,mock_qris",
    expires_at: "2026-07-18 10:00:00"
  };

  return {
    get calls() {
      return calls;
    },
    fetchImpl: async (url, init) => {
      calls += 1;
      assertion(url, init);

      return Response.json(payload);
    }
  };
}

async function callHandler({ payload = validPayload, env = {}, requestOptions = {}, fetchImpl, rawBody } = {}) {
  const db = env.DB || new FakeDB();
  const context = {
    request: createRequest(rawBody ?? payload, requestOptions),
    env: {
      ...baseEnv,
      ...env,
      DB: db
    }
  };

  const response = await handleCreateOrder(context, {
    fetchImpl,
    randomSource: {
      randomUUID: () => "12345678-1234-4234-9234-123456789abc"
    },
    now: () => new Date("2026-07-18T01:00:00.000Z")
  });
  const data = await response.json().catch(() => ({}));

  return { response, data, db };
}

async function captureLogs(fn) {
  const logs = [];
  const originalError = console.error;
  console.error = (...args) => logs.push(JSON.stringify(args));

  try {
    const result = await fn();
    return { result, logs };
  } finally {
    console.error = originalError;
  }
}

const tests = [
  [
    "API key di-trim sebelum dikirim ke Cashi",
    async () => {
      const mock = createSuccessFetch((url, init) => {
        assert.equal(init.headers["x-api-key"], "test_api_key");
      });
      await callHandler({
        env: { CASHI_API_KEY: "  test_api_key \r\n" },
        fetchImpl: mock.fetchImpl
      });
    }
  ],
  [
    "API key dengan wrapping quote dibersihkan",
    async () => {
      const mock = createSuccessFetch((url, init) => {
        assert.equal(init.headers["x-api-key"], "test_api_key");
      });
      await callHandler({
        env: { CASHI_API_KEY: "\"test_api_key\"" },
        fetchImpl: mock.fetchImpl
      });
    }
  ],
  [
    "API key dengan prefix header dibersihkan",
    () => {
      assert.equal(normalizeCashiApiKey("x-api-key: 'test_api_key'"), "test_api_key");
    }
  ],
  [
    "Produk NF-1 menghasilkan harga backend 95000",
    async () => {
      const mock = createSuccessFetch((url, init) => {
        const body = JSON.parse(init.body);
        assert.equal(body.amount, 95000);
      });
      const { response, data, db } = await callHandler({ fetchImpl: mock.fetchImpl });

      assert.equal(response.status, 201);
      assert.equal(data.base_amount, 95000);
      assert.equal(db.orders[0].base_amount, 95000);
    }
  ],
  [
    "Request Cashi mengirim Accept application/json dan header lengkap",
    async () => {
      const mock = createSuccessFetch((url, init) => {
        assert.equal(init.headers["Accept"], "application/json");
        assert.equal(init.headers["Content-Type"], "application/json");
        assert.equal(init.headers["x-api-key"], "test_api_key");
        assert.equal(Object.values(init.headers).every((value) => value !== undefined), true);
      });
      await callHandler({ fetchImpl: mock.fetchImpl });
    }
  ],
  [
    "Payload Cashi memakai amount number dan order_id string",
    async () => {
      const mock = createSuccessFetch((url, init) => {
        const body = JSON.parse(init.body);
        assert.equal(typeof body.amount, "number");
        assert.equal(body.amount, 95000);
        assert.equal(typeof body.order_id, "string");
        assert.match(body.order_id, /^NF-20260718-/);
      });
      await callHandler({ fetchImpl: mock.fetchImpl });
    }
  ],
  [
    "Manipulasi amount dari frontend tidak mengubah harga",
    async () => {
      const mock = createSuccessFetch((url, init) => {
        const body = JSON.parse(init.body);
        assert.equal(body.amount, 95000);
      });
      const payload = { ...validPayload, amount: 1, price: 1 };
      const { data, db } = await callHandler({ payload, fetchImpl: mock.fetchImpl });

      assert.equal(data.base_amount, 95000);
      assert.equal(db.orders[0].base_amount, 95000);
    }
  ],
  [
    "Product code tidak dikenal ditolak",
    async () => {
      const { response } = await callHandler({ payload: { ...validPayload, product_code: "NF-X" } });
      assert.equal(response.status, 400);
    }
  ],
  [
    "Nama kosong ditolak",
    async () => {
      const { response } = await callHandler({ payload: { ...validPayload, customer_name: "" } });
      assert.equal(response.status, 400);
    }
  ],
  [
    "Nomor HP tidak valid ditolak",
    async () => {
      const { response } = await callHandler({ payload: { ...validPayload, phone: "12345" } });
      assert.equal(response.status, 400);
    }
  ],
  [
    "Nomor 08 dinormalisasi menjadi 62",
    async () => {
      const mock = createSuccessFetch();
      const { db } = await callHandler({ fetchImpl: mock.fetchImpl });
      assert.equal(db.orders[0].phone, "6281234567890");
    }
  ],
  [
    "Alamat terlalu pendek ditolak",
    async () => {
      const { response } = await callHandler({ payload: { ...validPayload, address: "Jl" } });
      assert.equal(response.status, 400);
    }
  ],
  [
    "JSON rusak ditolak",
    async () => {
      const { response } = await callHandler({ rawBody: "{" });
      assert.equal(response.status, 400);
    }
  ],
  [
    "Content-Type salah ditolak",
    async () => {
      const { response } = await callHandler({
        rawBody: JSON.stringify(validPayload),
        requestOptions: { headers: { "Content-Type": "text/plain" } }
      });
      assert.equal(response.status, 415);
    }
  ],
  [
    "Origin tidak diizinkan ditolak",
    async () => {
      const { response } = await callHandler({
        requestOptions: { origin: "https://evil.example" }
      });
      assert.equal(response.status, 403);
    }
  ],
  [
    "Origin same-origin tetap diizinkan saat ALLOWED_ORIGIN kosong",
    async () => {
      const mock = createSuccessFetch();
      const { response } = await callHandler({
        env: { ALLOWED_ORIGIN: "" },
        requestOptions: { origin: "https://checkout.example" },
        fetchImpl: mock.fetchImpl
      });

      assert.equal(response.status, 201);
    }
  ],
  [
    "Origin same-origin tetap diizinkan saat ALLOWED_ORIGIN berisi URL lama",
    async () => {
      const mock = createSuccessFetch();
      const { response } = await callHandler({
        env: { ALLOWED_ORIGIN: "https://old-preview.example" },
        requestOptions: { origin: "https://checkout.example" },
        fetchImpl: mock.fetchImpl
      });

      assert.equal(response.status, 201);
    }
  ],
  [
    "API Cashi gagal menghasilkan HTTP 502",
    async () => {
      const { result, logs } = await captureLogs(() =>
        callHandler({
          fetchImpl: async () => new Response(null, { status: 400 })
        })
      );

      assert.equal(result.response.status, 502);
      assert.equal(result.db.orders[0].payment_status, "PAYMENT_FAILED");
      assert.ok(!JSON.stringify(result.data).includes("test_api_key"));
      assert.ok(!logs.join("\n").includes("test_api_key"));
      assert.ok(logs.join("\n").includes("\"api_key_present\":true"));
      assert.ok(logs.join("\n").includes("\"api_key_length\":12"));
      assert.ok(logs.join("\n").includes("\"api_key_prefix\":\"test\""));
      assert.ok(logs.join("\n").includes("\"api_key_suffix\":\"_key\""));
      assert.ok(logs.join("\n").includes("\"request_amount\":95000"));
      assert.ok(logs.join("\n").includes("\"request_url\":\"https://cashi.id/api/create-order\""));
      assert.ok(logs.join("\n").includes("\"response_content_type\":\"<no content-type>\""));
      assert.ok(logs.join("\n").includes("\"response_body\":\"<empty response body>\""));
    }
  ],
  [
    "Respons Cashi berhasil disimpan ke database",
    async () => {
      const mock = createSuccessFetch((url, init) => {
        assert.equal(url, "https://cashi.id/api/create-order");
        assert.equal(init.headers["x-api-key"], "test_api_key");
        assert.equal(init.headers["Accept"], "application/json");
      });
      const { data, db } = await callHandler({ fetchImpl: mock.fetchImpl });

      assert.equal(data.payment_amount, 95023);
      assert.equal(data.checkout_url, "https://cashi.id/pay/INV-9921");
      assert.equal(data.qr_url, "data:image/png;base64,mock_qris");
      assert.equal(db.orders[0].payment_amount, 95023);
      assert.equal(db.orders[0].checkout_url, "https://cashi.id/pay/INV-9921");
      assert.ok(db.orders[0].cashi_payload.includes("INV-9921"));
    }
  ],
  [
    "Respons camelCase Cashi dapat diproses",
    async () => {
      const mock = createSuccessFetch(
        () => {},
        {
          success: true,
          orderId: "INV-CAMEL",
          provider_order_id: "PROVIDER-CAMEL",
          amount: 95023,
          checkout_url: "https://cashi.id/pay/INV-CAMEL",
          qrUrl: "data:image/png;base64,camel_qris",
          qr_string: "000201010212",
          expires_at: "2026-07-18 10:00:00"
        }
      );
      const { data, db } = await callHandler({ fetchImpl: mock.fetchImpl });

      assert.equal(data.payment_amount, 95023);
      assert.equal(data.checkout_url, "https://cashi.id/pay/INV-CAMEL");
      assert.equal(data.qr_url, "data:image/png;base64,camel_qris");
      assert.ok(db.orders[0].cashi_payload.includes("INV-CAMEL"));
      assert.ok(db.orders[0].cashi_payload.includes("qr_string"));
    }
  ],
  [
    "Respons snake_case Cashi dapat diproses",
    async () => {
      const mock = createSuccessFetch(
        () => {},
        {
          success: true,
          order_id: "INV_SNAKE",
          provider_order_id: "PROVIDER_SNAKE",
          amount: 95023,
          checkout_url: "https://cashi.id/pay/INV_SNAKE",
          qr_url: "data:image/png;base64,snake_qris",
          qr_string: "000201010212",
          expires_at: "2026-07-18 10:00:00"
        }
      );
      const { data, db } = await callHandler({ fetchImpl: mock.fetchImpl });

      assert.equal(data.payment_amount, 95023);
      assert.equal(data.checkout_url, "https://cashi.id/pay/INV_SNAKE");
      assert.equal(data.qr_url, "data:image/png;base64,snake_qris");
      assert.ok(db.orders[0].cashi_payload.includes("provider_order_id"));
    }
  ],
  [
    "Klik ganda dengan client_request_id sama mengembalikan order yang sama",
    async () => {
      const db = new FakeDB();
      const mock = createSuccessFetch();
      const first = await callHandler({ env: { DB: db }, fetchImpl: mock.fetchImpl });
      const second = await callHandler({ env: { DB: db }, fetchImpl: mock.fetchImpl });

      assert.equal(first.data.order_id, second.data.order_id);
      assert.equal(db.orders.length, 1);
      assert.equal(mock.calls, 1);
    }
  ],
  [
    "Order PAYMENT_FAILED tidak dipakai ulang untuk request Cashi baru",
    async () => {
      const db = new FakeDB([
        createStoredOrder({
          payment_status: "PAYMENT_FAILED",
          updated_at: "2026-07-18T01:01:00.000Z"
        })
      ]);
      let calls = 0;
      const { response, db: resultDb } = await callHandler({
        env: { DB: db },
        fetchImpl: async () => {
          calls += 1;
          return Response.json({ success: true });
        }
      });

      assert.equal(response.status, 409);
      assert.equal(calls, 0);
      assert.equal(resultDb.orders.length, 1);
      assert.equal(resultDb.orders[0].order_id, "NF-20260718-EXIST1");
    }
  ],
  [
    "API key tidak muncul pada respons sukses",
    async () => {
      const mock = createSuccessFetch();
      const { data } = await callHandler({ fetchImpl: mock.fetchImpl });
      assert.ok(!JSON.stringify(data).includes("test_api_key"));
    }
  ]
];

for (const [name, test] of tests) {
  await test();
  console.log(`PASS ${name}`);
}
