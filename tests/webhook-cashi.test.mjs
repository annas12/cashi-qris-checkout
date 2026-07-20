import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  handleCashiWebhook,
  hmacSha256Hex,
  sha256Hex
} from "../functions/api/webhook/cashi.js";

const SECRET = "test_webhook_secret";
const NOW = new Date("2026-07-18T03:30:00.000Z");

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
    if (this.sql.includes("FROM webhook_events")) {
      const eventKey = this.params[0];
      const event = this.db.webhookEvents.find((item) => item.event_key === eventKey);
      return event ? { ...event } : null;
    }

    if (this.sql.includes("FROM orders")) {
      const orderId = this.params[0];
      const order = this.db.orders.find((item) => item.order_id === orderId);
      return order ? { ...order } : null;
    }

    throw new Error(`Unhandled first SQL: ${this.sql}`);
  }

  async run() {
    if (this.sql.includes("INSERT INTO webhook_events")) {
      const [
        eventKey,
        eventName,
        orderId,
        payloadHash,
        processingStatus,
        responseCode
      ] = this.params;

      if (this.db.webhookEvents.some((item) => item.event_key === eventKey)) {
        throw new Error("UNIQUE constraint failed: webhook_events.event_key");
      }

      this.db.webhookEvents.push({
        id: this.db.webhookEvents.length + 1,
        event_key: eventKey,
        event_name: eventName,
        order_id: orderId,
        payload_hash: payloadHash,
        processing_status: processingStatus,
        received_at: "2026-07-18 10:30:00",
        processed_at: null,
        response_code: responseCode
      });

      return { success: true, meta: { changes: 1, rows_written: 1 } };
    }

    if (this.sql.includes("UPDATE webhook_events")) {
      const [processingStatus, processedAt, responseCode, eventKey] = this.params;
      const event = this.db.webhookEvents.find((item) => item.event_key === eventKey);

      if (event) {
        event.processing_status = processingStatus;
        event.processed_at = processedAt;
        event.response_code = responseCode;
      }

      return { success: true, meta: { changes: event ? 1 : 0, rows_written: event ? 1 : 0 } };
    }

    if (this.sql.includes("UPDATE orders")) {
      const [paymentStatus, paidAt, orderId, currentStatus, amount] = this.params;
      const order = this.db.orders.find(
        (item) =>
          item.order_id === orderId &&
          item.payment_status === currentStatus &&
          Number(item.payment_amount) === Number(amount)
      );

      if (order) {
        order.payment_status = paymentStatus;
        order.paid_at = paidAt;
        order.updated_at = "2026-07-18 10:30:00";
        this.db.orderUpdateCount += 1;
      }

      return { success: true, meta: { changes: order ? 1 : 0, rows_written: order ? 1 : 0 } };
    }

    throw new Error(`Unhandled run SQL: ${this.sql}`);
  }
}

class FakeDB {
  constructor(orders = []) {
    this.orders = orders;
    this.webhookEvents = [];
    this.orderUpdateCount = 0;
  }

  prepare(sql) {
    return new FakeStatement(this, sql);
  }
}

function createOrder(overrides = {}) {
  return {
    order_id: "NF-20260718-ABC123",
    payment_amount: 5023,
    payment_status: "PENDING",
    paid_at: null,
    updated_at: null,
    ...overrides
  };
}

function createPayload(overrides = {}) {
  return {
    event: "PAYMENT_SETTLED",
    data: {
      order_id: "NF-20260718-ABC123",
      amount: 5023,
      status: "SETTLED",
      paid_at: "2026-07-18 10:20:00",
      ...(overrides.data || {})
    },
    ...Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== "data"))
  };
}

async function callWebhook({
  method = "POST",
  payload = createPayload(),
  rawBody,
  signature,
  contentType = "application/json",
  envSecret = SECRET,
  db = new FakeDB([createOrder()])
} = {}) {
  const body = rawBody ?? JSON.stringify(payload);
  const headers = new Headers();

  if (contentType) {
    headers.set("Content-Type", contentType);
  }

  if (signature !== null) {
    headers.set("x-gateway-signature", signature ?? await hmacSha256Hex(SECRET, body));
  }

  const init = {
    method,
    headers
  };

  if (method !== "GET" && method !== "HEAD") {
    init.body = body;
  }

  const env = { DB: db };

  if (envSecret !== null) {
    env.CASHI_WEBHOOK_SECRET = envSecret;
  }

  const response = await handleCashiWebhook(
    {
      request: new Request("https://checkout.example/api/webhook/cashi", init),
      env
    },
    {
      now: () => NOW
    }
  );
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};

  return { response, data, text, db, rawBody: body };
}

async function captureLogs(fn) {
  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => logs.push(args.join(" "));

  try {
    const result = await fn();
    return { result, logs };
  } finally {
    console.log = originalLog;
  }
}

const tests = [
  [
    "Method selain POST ditolak",
    async () => {
      const { response } = await callWebhook({ method: "GET" });
      assert.equal(response.status, 405);
    }
  ],
  [
    "Content-Type salah ditolak",
    async () => {
      const { response } = await callWebhook({ contentType: "text/plain" });
      assert.equal(response.status, 415);
    }
  ],
  [
    "Secret tidak tersedia ditolak aman",
    async () => {
      const { response, text } = await callWebhook({ envSecret: null });
      assert.equal(response.status, 500);
      assert.ok(!text.includes(SECRET));
    }
  ],
  [
    "Signature kosong ditolak",
    async () => {
      const { response, data } = await callWebhook({ signature: null });
      assert.equal(response.status, 401);
      assert.equal(data.message, "Invalid signature");
    }
  ],
  [
    "Signature salah ditolak",
    async () => {
      const { response } = await callWebhook({ signature: "bad_signature" });
      assert.equal(response.status, 401);
    }
  ],
  [
    "Signature benar diterima",
    async () => {
      const { response, data } = await callWebhook();
      assert.equal(response.status, 200);
      assert.equal(data.success, true);
    }
  ],
  [
    "JSON rusak ditolak",
    async () => {
      const rawBody = "{";
      const signature = await hmacSha256Hex(SECRET, rawBody);
      const { response } = await callWebhook({ rawBody, signature });
      assert.equal(response.status, 400);
    }
  ],
  [
    "Event selain PAYMENT_SETTLED diabaikan",
    async () => {
      const db = new FakeDB([createOrder()]);
      const { response } = await callWebhook({
        db,
        payload: createPayload({ event: "PAYMENT_CREATED" })
      });
      assert.equal(response.status, 200);
      assert.equal(db.orders[0].payment_status, "PENDING");
      assert.equal(db.webhookEvents[0].processing_status, "PROCESSED");
    }
  ],
  [
    "order_id kosong ditolak",
    async () => {
      const { response, db } = await callWebhook({
        payload: createPayload({ data: { order_id: "" } })
      });
      assert.equal(response.status, 400);
      assert.equal(db.webhookEvents[0].processing_status, "REJECTED");
    }
  ],
  [
    "status bukan SETTLED ditolak",
    async () => {
      const { response } = await callWebhook({
        payload: createPayload({ data: { status: "PENDING" } })
      });
      assert.equal(response.status, 400);
    }
  ],
  [
    "amount tidak valid ditolak",
    async () => {
      const { response } = await callWebhook({
        payload: createPayload({ data: { amount: 0 } })
      });
      assert.equal(response.status, 400);
    }
  ],
  [
    "Order tidak ditemukan",
    async () => {
      const { response } = await callWebhook({ db: new FakeDB([]) });
      assert.equal(response.status, 404);
    }
  ],
  [
    "Nominal webhook berbeda dengan payment_amount",
    async () => {
      const db = new FakeDB([createOrder()]);
      const { response } = await callWebhook({
        db,
        payload: createPayload({ data: { amount: 95024 } })
      });
      assert.equal(response.status, 409);
      assert.equal(db.orders[0].payment_status, "PENDING");
    }
  ],
  [
    "Order PENDING berubah menjadi PAID",
    async () => {
      const db = new FakeDB([createOrder()]);
      const { response } = await callWebhook({ db });
      assert.equal(response.status, 200);
      assert.equal(db.orders[0].payment_status, "PAID");
      assert.equal(db.orderUpdateCount, 1);
    }
  ],
  [
    "paid_at terisi",
    async () => {
      const db = new FakeDB([createOrder()]);
      await callWebhook({ db });
      assert.equal(db.orders[0].paid_at, "2026-07-18 10:20:00");
    }
  ],
  [
    "Order PAID tidak diproses ulang",
    async () => {
      const db = new FakeDB([createOrder({ payment_status: "PAID", paid_at: "2026-07-18 10:10:00" })]);
      const { response } = await callWebhook({ db });
      assert.equal(response.status, 200);
      assert.equal(db.orderUpdateCount, 0);
      assert.equal(db.orders[0].paid_at, "2026-07-18 10:10:00");
    }
  ],
  [
    "Webhook yang sama dua kali tetap idempotent",
    async () => {
      const db = new FakeDB([createOrder()]);
      const payload = createPayload();
      const rawBody = JSON.stringify(payload);
      const signature = await hmacSha256Hex(SECRET, rawBody);
      await callWebhook({ db, rawBody, signature });
      const second = await callWebhook({ db, rawBody, signature });

      assert.equal(second.response.status, 200);
      assert.equal(db.orderUpdateCount, 1);
      assert.equal(db.webhookEvents.length, 1);
    }
  ],
  [
    "Event key unik tersimpan",
    async () => {
      const db = new FakeDB([createOrder()]);
      await callWebhook({ db, payload: createPayload({ event_id: "evt_test_12345678" }) });
      assert.equal(db.webhookEvents[0].event_key, "evt_test_12345678");
    }
  ],
  [
    "Payload hash tersimpan",
    async () => {
      const db = new FakeDB([createOrder()]);
      const rawBody = JSON.stringify(createPayload());
      const signature = await hmacSha256Hex(SECRET, rawBody);
      await callWebhook({ db, rawBody, signature });
      assert.equal(db.webhookEvents[0].payload_hash, await sha256Hex(rawBody));
    }
  ],
  [
    "Order EXPIRED tidak otomatis menjadi PAID",
    async () => {
      const db = new FakeDB([createOrder({ payment_status: "EXPIRED" })]);
      const { response } = await callWebhook({ db });
      assert.equal(response.status, 409);
      assert.equal(db.orders[0].payment_status, "EXPIRED");
    }
  ],
  [
    "Order PAYMENT_FAILED tidak otomatis menjadi PAID",
    async () => {
      const db = new FakeDB([createOrder({ payment_status: "PAYMENT_FAILED" })]);
      const { response } = await callWebhook({ db });
      assert.equal(response.status, 409);
      assert.equal(db.orders[0].payment_status, "PAYMENT_FAILED");
    }
  ],
  [
    "Response tidak mengandung secret",
    async () => {
      const { result, logs } = await captureLogs(() => callWebhook());
      assert.ok(!result.text.includes(SECRET));
      assert.ok(!logs.join("\n").includes(SECRET));
    }
  ],
  [
    "Response menggunakan Cache-Control no-store",
    async () => {
      const { response } = await callWebhook();
      assert.equal(response.headers.get("Cache-Control"), "no-store");
    }
  ],
  [
    "Raw body yang sama menghasilkan signature yang konsisten",
    async () => {
      const rawBody = JSON.stringify(createPayload());
      const first = await hmacSha256Hex(SECRET, rawBody);
      const second = await hmacSha256Hex(SECRET, rawBody);
      assert.equal(first, second);
      assert.match(first, /^[a-f0-9]{64}$/);
    }
  ],
  [
    "Prefix sha256= pada signature didukung",
    async () => {
      const rawBody = JSON.stringify(createPayload());
      const signature = `sha256=${await hmacSha256Hex(SECRET, rawBody)}`;
      const { response } = await callWebhook({ rawBody, signature });
      assert.equal(response.status, 200);
    }
  ],
  [
    "Migration 0003 membuat tabel dan index webhook_events",
    async () => {
      const sql = await readFile("migrations/0003_create_webhook_events.sql", "utf8");
      assert.match(sql, /CREATE TABLE IF NOT EXISTS webhook_events/);
      assert.match(sql, /event_key TEXT UNIQUE NOT NULL/);
      assert.match(sql, /payload_hash TEXT NOT NULL/);
      assert.match(sql, /idx_webhook_events_event_key/);
      assert.match(sql, /idx_webhook_events_order_id/);
      assert.match(sql, /idx_webhook_events_received_at/);
    }
  ]
];

for (const [name, test] of tests) {
  await test();
  console.log(`PASS ${name}`);
}
