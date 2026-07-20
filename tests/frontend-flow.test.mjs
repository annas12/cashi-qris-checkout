import assert from "node:assert/strict";
import {
  createPaymentPollingController,
  fetchOrderStatus as fetchCheckoutOrderStatus,
  formatRupiah,
  initCreateOrderForm,
  isValidCheckoutUrl,
  isValidQrUrl
} from "../public/js/checkout.js";
import {
  fetchOrderStatus as fetchSuccessOrderStatus,
  getSuccessDecision
} from "../public/js/success.js";

class FakeStorage {
  constructor(entries = {}) {
    this.map = new Map(Object.entries(entries));
  }

  getItem(key) {
    return this.map.has(key) ? this.map.get(key) : null;
  }

  setItem(key, value) {
    this.map.set(key, String(value));
  }

  removeItem(key) {
    this.map.delete(key);
  }
}

function createFormTestDocument(values) {
  const listeners = {};
  const fieldWrap = {
    classList: {
      toggle: () => {}
    }
  };
  const fields = new Map(
    ["fullName", "whatsapp", "address", "packageId"].map((name) => [
      name,
      {
        closest: () => fieldWrap
      }
    ])
  );
  const errors = new Map(
    ["fullName", "whatsapp", "address", "packageId"].map((name) => [
      name,
      {
        textContent: ""
      }
    ])
  );
  const submitButton = {
    disabled: false,
    textContent: "Buat Pesanan QRIS"
  };
  const form = {
    addEventListener: (type, handler) => {
      listeners[type] = handler;
    },
    querySelector: (selector) => (selector === "button[type='submit']" ? submitButton : null)
  };
  const packageSelect = {
    value: values.packageId,
    addEventListener: () => {}
  };
  const orderTotal = {
    textContent: ""
  };
  const formAlert = {
    textContent: "",
    className: "form-alert"
  };

  return {
    doc: {
      querySelector: (selector) => {
        if (selector === "#checkoutForm") return form;
        if (selector === "#packageId") return packageSelect;
        if (selector === "#orderTotal") return orderTotal;
        if (selector === "#formAlert") return formAlert;

        const fieldMatch = selector.match(/^\[name="(.+)"\]$/);
        if (fieldMatch) return fields.get(fieldMatch[1]) || null;

        const errorMatch = selector.match(/^\[data-error-for="(.+)"\]$/);
        if (errorMatch) return errors.get(errorMatch[1]) || null;

        return null;
      }
    },
    formAlert,
    listeners,
    submitButton
  };
}

const tests = [
  [
    "frontend mereset pendingClientRequestId setelah create-order gagal",
    async () => {
      const values = {
        fullName: "Budi Santoso",
        whatsapp: "081234567890",
        address: "Jl. Melati No. 10",
        packageId: "NF-1"
      };
      const { doc, formAlert, listeners, submitButton } = createFormTestDocument(values);
      const storage = new FakeStorage({ pendingClientRequestId: "req_frontend_failed" });
      const originalFormData = globalThis.FormData;
      let createOrderCalls = 0;

      globalThis.FormData = class {
        get(name) {
          return values[name] || "";
        }
      };

      try {
        initCreateOrderForm(doc, {
          sessionStorage: storage,
          fetch: async (url, init) => {
            createOrderCalls += 1;
            const body = JSON.parse(init.body);
            assert.equal(body.client_request_id, "req_frontend_failed");

            return Response.json(
              { message: "Pembayaran belum dapat dibuat. Silakan coba kembali." },
              { status: 502 }
            );
          },
          location: {
            assign: () => {
              throw new Error("Tidak boleh redirect saat create-order gagal");
            }
          }
        });

        await listeners.submit({
          preventDefault: () => {}
        });
      } finally {
        globalThis.FormData = originalFormData;
      }

      assert.equal(createOrderCalls, 1);
      assert.equal(storage.getItem("pendingClientRequestId"), null);
      assert.equal(submitButton.disabled, false);
      assert.equal(submitButton.textContent, "Buat Pesanan QRIS");
      assert.equal(formAlert.className, "form-alert visible error");
    }
  ],
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
    "halaman checkout dan sukses bisa fetch status order",
    async () => {
      const fetchImpl = async (url, init) => {
        assert.equal(String(url), "/api/check-status?order_id=NF-20260718-ABC123");
        assert.equal(init.signal instanceof AbortSignal, true);

        return new Response(JSON.stringify({
          success: true,
          order_id: "NF-20260718-ABC123",
          payment_status: "PAID"
        }), {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        });
      };

      const checkoutOrder = await fetchCheckoutOrderStatus("NF-20260718-ABC123", { fetchImpl });
      const successOrder = await fetchSuccessOrderStatus("NF-20260718-ABC123", { fetchImpl });

      assert.equal(checkoutOrder.payment_status, "PAID");
      assert.equal(successOrder.payment_status, "PAID");
    }
  ],
  [
    "format rupiah benar",
    () => {
      assert.equal(formatRupiah(5023), "Rp5.023");
    }
  ]
];

for (const [name, test] of tests) {
  await test();
  console.log(`PASS ${name}`);
}
