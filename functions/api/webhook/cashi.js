const ALLOWED_STATUSES = new Set(["PENDING", "PAID", "FAILED", "EXPIRED"]);

function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store"
    }
  });
}

export async function onRequestPost(context) {
  let payload;

  try {
    payload = await context.request.json();
  } catch (error) {
    return json({ message: "Body webhook harus berupa JSON valid." }, 400);
  }

  const orderId = String(payload.order_id || payload.orderId || "").trim();
  const status = String(payload.status || "").trim().toUpperCase();
  const paymentAmount = Number(payload.payment_amount ?? payload.amount);
  const safePaymentAmount = Number.isFinite(paymentAmount) ? paymentAmount : null;
  const updatedAt = new Date().toISOString();

  if (!orderId || !ALLOWED_STATUSES.has(status)) {
    return json({ message: "Payload webhook belum valid." }, 400);
  }

  if (context.env.DB) {
    await context.env.DB.prepare(
      `UPDATE orders
       SET payment_status = ?,
           payment_amount = COALESCE(?, payment_amount),
           cashi_payload = ?,
           updated_at = ?,
           paid_at = CASE WHEN ? = 'PAID' THEN ? ELSE paid_at END
       WHERE order_id = ?`
    )
      .bind(
        status,
        safePaymentAmount,
        JSON.stringify(payload),
        updatedAt,
        status,
        updatedAt,
        orderId
      )
      .run();
  }

  return json({
    received: true,
    order_id: orderId,
    status: status.toLowerCase(),
    payment_status: status,
    message: "Webhook diterima. Verifikasi signature dapat ditambahkan saat secret Cashi tersedia."
  });
}

export function onRequestGet() {
  return json({ message: "Webhook Cashi menerima metode POST." }, 405);
}
