import assert from "node:assert/strict";
import { handleCreateOrder } from "../functions/api/create-order.js";

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
  constructor() {
    this.orders = [];
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

function createSuccessFetch(assertion = () => {}) {
  let calls = 0;

  return {
    get calls() {
      return calls;
    },
    fetchImpl: async (url, init) => {
      calls += 1;
      assertion(url, init);

      return Response.json({
        success: true,
        order_id: "INV-9921",
        amount: 95023,
        checkout_url: "https://cashi.id/pay/INV-9921",
        qrUrl: "data:image/png;base64,mock_qris",
        expires_at: "2026-07-18 10:00:00"
      });
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
    "API Cashi gagal menghasilkan HTTP 502",
    async () => {
      const { result, logs } = await captureLogs(() =>
        callHandler({
          fetchImpl: async () => new Response("{}", { status: 500 })
        })
      );

      assert.equal(result.response.status, 502);
      assert.equal(result.db.orders[0].payment_status, "PAYMENT_FAILED");
      assert.ok(!JSON.stringify(result.data).includes("test_api_key"));
      assert.ok(!logs.join("\n").includes("test_api_key"));
    }
  ],
  [
    "Respons Cashi berhasil disimpan ke database",
    async () => {
      const mock = createSuccessFetch((url, init) => {
        assert.equal(url, "https://cashi.id/api/create-order");
        assert.equal(init.headers["x-api-key"], "test_api_key");
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
