import assert from "node:assert/strict";
import { handleCheckStatus } from "../functions/api/check-status.js";

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
    if (this.sql.includes("FROM orders") && this.sql.includes("WHERE order_id = ?")) {
      const orderId = this.params[0];
      const order = this.db.orders.find((item) => item.order_id === orderId);
      return order ? { ...order } : null;
    }

    throw new Error(`Unhandled first SQL: ${this.sql}`);
  }

  async run() {
    if (this.sql.includes("SET payment_status = ?")) {
      const [paymentStatus, updatedAt, orderId, currentStatus] = this.params;
      const order = this.db.orders.find(
        (item) => item.order_id === orderId && item.payment_status === currentStatus
      );

      if (order) {
        order.payment_status = paymentStatus;
        order.updated_at = updatedAt;
        this.db.updates.push({ orderId, paymentStatus, updatedAt });
      }

      return { success: true };
    }

    throw new Error(`Unhandled run SQL: ${this.sql}`);
  }
}

class FakeDB {
  constructor(orders = []) {
    this.orders = orders;
    this.updates = [];
  }

  prepare(sql) {
    return new FakeStatement(this, sql);
  }
}

function createOrder(overrides = {}) {
  return {
    order_id: "NF-20260718-ABC123",
    product_name: "Nutriflakes 1 Box",
    quantity: 1,
    base_amount: 95000,
    payment_amount: 95023,
    payment_status: "PENDING",
    checkout_url: "https://cashi.id/pay/NF-20260718-ABC123",
    qr_url: "data:image/png;base64,iVBORw0KGgo=",
    expires_at: "2099-01-01 10:00:00",
    paid_at: null,
    customer_name: "Rahasia",
    phone: "6281234567890",
    address: "Alamat rahasia",
    client_request_id: "client-secret",
    cashi_payload: '{"api_key":"secret"}',
    ...overrides
  };
}

async function callHandler({ orderId = "NF-20260718-ABC123", orders = [], now } = {}) {
  const url = orderId === null
    ? "https://checkout.example/api/check-status"
    : `https://checkout.example/api/check-status?order_id=${encodeURIComponent(orderId)}`;
  const db = new FakeDB(orders);
  const response = await handleCheckStatus(
    {
      request: new Request(url, { method: "GET" }),
      env: { DB: db }
    },
    {
      now: now ? () => now : undefined
    }
  );
  const data = await response.json().catch(() => ({}));

  return { response, data, db };
}

const tests = [
  [
    "order_id kosong ditolak",
    async () => {
      const { response } = await callHandler({ orderId: null });
      assert.equal(response.status, 400);
    }
  ],
  [
    "format order_id tidak valid ditolak",
    async () => {
      const { response } = await callHandler({ orderId: "javascript:alert(1)" });
      assert.equal(response.status, 400);
    }
  ],
  [
    "order tidak ditemukan menghasilkan 404",
    async () => {
      const { response, data } = await callHandler();
      assert.equal(response.status, 404);
      assert.equal(data.success, false);
    }
  ],
  [
    "data sensitif tidak muncul dalam respons",
    async () => {
      const { data } = await callHandler({ orders: [createOrder()] });
      const serialized = JSON.stringify(data);

      assert.ok(!serialized.includes("customer_name"));
      assert.ok(!serialized.includes("phone"));
      assert.ok(!serialized.includes("address"));
      assert.ok(!serialized.includes("client_request_id"));
      assert.ok(!serialized.includes("cashi_payload"));
      assert.ok(!serialized.includes("secret"));
    }
  ],
  [
    "PENDING dikembalikan dengan benar",
    async () => {
      const { data } = await callHandler({ orders: [createOrder()] });
      assert.equal(data.success, true);
      assert.equal(data.payment_status, "PENDING");
      assert.equal(data.product_name, "Nutriflakes 1 Box");
      assert.equal(data.payment_amount, 95023);
    }
  ],
  [
    "PAID dikembalikan dengan benar",
    async () => {
      const { data } = await callHandler({
        orders: [
          createOrder({
            payment_status: "PAID",
            paid_at: "2026-07-18 09:45:00"
          })
        ]
      });
      assert.equal(data.payment_status, "PAID");
      assert.equal(data.paid_at, "2026-07-18 09:45:00");
    }
  ],
  [
    "order kedaluwarsa berubah menjadi EXPIRED",
    async () => {
      const { data, db } = await callHandler({
        orders: [createOrder({ expires_at: "2026-07-18 10:00:00" })],
        now: new Date("2026-07-18T03:00:01.000Z")
      });
      assert.equal(data.payment_status, "EXPIRED");
      assert.equal(db.orders[0].payment_status, "EXPIRED");
      assert.equal(db.updates.length, 1);
    }
  ],
  [
    "status PAID tidak berubah menjadi EXPIRED",
    async () => {
      const { data, db } = await callHandler({
        orders: [
          createOrder({
            payment_status: "PAID",
            paid_at: "2026-07-18 09:45:00"
          })
        ],
        now: new Date("2026-07-18T03:00:01.000Z")
      });
      assert.equal(data.payment_status, "PAID");
      assert.equal(db.updates.length, 0);
    }
  ],
  [
    "API response menggunakan Cache-Control no-store",
    async () => {
      const { response } = await callHandler({ orders: [createOrder()] });
      assert.equal(response.headers.get("Cache-Control"), "no-store");
      assert.match(response.headers.get("Content-Type"), /application\/json/);
    }
  ]
];

for (const [name, test] of tests) {
  await test();
  console.log(`PASS ${name}`);
}
