import assert from "node:assert/strict";
import {
  createPaymentPollingController,
  formatRupiah,
  isValidCheckoutUrl,
  isValidQrUrl
} from "../public/js/checkout.js";
import { getSuccessDecision } from "../public/js/success.js";

const tests = [
  [
    "qr_url data PNG valid diterima frontend",
    () => {
      assert.equal(isValidQrUrl("data:image/png;base64,iVBORw0KGgo="), true);
    }
  ],
  [
    "qr_url HTTPS valid diterima frontend",
    () => {
      assert.equal(isValidQrUrl("https://cdn.cashi.id/qris/order.png"), true);
    }
  ],
  [
    "javascript: QR ditolak frontend",
    () => {
      assert.equal(isValidQrUrl("javascript:alert(1)"), false);
      assert.equal(isValidQrUrl("data:text/html;base64,PGgxPkZha2U8L2gxPg=="), false);
      assert.equal(isValidQrUrl("http://cashi.id/qris.png"), false);
    }
  ],
  [
    "checkout URL bukan HTTPS ditolak",
    () => {
      assert.equal(isValidCheckoutUrl("http://cashi.id/pay/NF-20260718-ABC123"), false);
      assert.equal(isValidCheckoutUrl("https://evil.example/pay/NF-20260718-ABC123"), false);
      assert.equal(isValidCheckoutUrl("https://pay.cashi.id/NF-20260718-ABC123"), true);
    }
  ],
  [
    "polling berhenti saat PAID",
    async () => {
      let stoppedReason = null;
      let statusCount = 0;
      const controller = createPaymentPollingController({
        getStatus: async () => ({ payment_status: "PAID" }),
        onStatus: () => {
          statusCount += 1;
        },
        onStop: (reason) => {
          stoppedReason = reason;
        }
      });

      await controller.start({ immediate: true });

      assert.equal(statusCount, 1);
      assert.equal(stoppedReason, "PAID");
      assert.equal(controller.hasTimer(), false);
      assert.equal(controller.isPolling(), false);
    }
  ],
  [
    "polling berhenti saat EXPIRED",
    async () => {
      let stoppedReason = null;
      const controller = createPaymentPollingController({
        getStatus: async () => ({ payment_status: "EXPIRED" }),
        onStatus: () => {},
        onStop: (reason) => {
          stoppedReason = reason;
        }
      });

      await controller.start({ immediate: true });

      assert.equal(stoppedReason, "EXPIRED");
      assert.equal(controller.hasTimer(), false);
    }
  ],
  [
    "polling tidak berjalan ganda",
    () => {
      const scheduledTimers = [];
      const controller = createPaymentPollingController({
        getStatus: async () => ({ payment_status: "PENDING" }),
        onStatus: () => {},
        now: () => 0,
        setTimeoutImpl: (callback) => {
          scheduledTimers.push(callback);
          return scheduledTimers.length;
        },
        clearTimeoutImpl: () => {}
      });

      controller.start();
      controller.start();

      assert.equal(scheduledTimers.length, 1);
      assert.equal(controller.hasTimer(), true);
    }
  ],
  [
    "halaman sukses menolak order yang belum PAID",
    () => {
      const decision = getSuccessDecision("NF-20260718-ABC123", {
        payment_status: "PENDING"
      });

      assert.equal(decision.action, "redirect");
      assert.equal(decision.target, "/checkout.html?order_id=NF-20260718-ABC123");
    }
  ],
  [
    "format rupiah benar",
    () => {
      assert.equal(formatRupiah(95023), "Rp95.023");
    }
  ]
];

for (const [name, test] of tests) {
  await test();
  console.log(`PASS ${name}`);
}
