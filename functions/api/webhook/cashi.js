const ALLOWED_STATUSES = new Set(["pending", "paid", "failed", "expired"]);

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
  const status = String(payload.status || "").trim().toLowerCase();

  if (!orderId || !ALLOWED_STATUSES.has(status)) {
    return json({ message: "Payload webhook belum valid." }, 400);
  }

  if (context.env.DB) {
    await context.env.DB.prepare(
      `UPDATE orders
       SET status = ?, provider_reference = ?, raw_payload = ?, updated_at = ?
       WHERE id = ?`
    )
      .bind(
        status,
        String(payload.reference || payload.transaction_id || ""),
        JSON.stringify(payload),
        new Date().toISOString(),
        orderId
      )
      .run();
  }

  return json({
    received: true,
    order_id: orderId,
    status,
    message: "Webhook diterima. Verifikasi signature dapat ditambahkan saat secret Cashi tersedia."
  });
}

export function onRequestGet() {
  return json({ message: "Webhook Cashi menerima metode POST." }, 405);
}
