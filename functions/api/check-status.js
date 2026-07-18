function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store"
    }
  });
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const orderId = String(url.searchParams.get("order_id") || "").trim();

  if (!/^ORD-\d+-[A-F0-9-]{8,}$/i.test(orderId)) {
    return json({ message: "Parameter order_id tidak valid." }, 400);
  }

  if (!context.env.DB) {
    return json({
      order_id: orderId,
      status: "pending",
      source: "demo",
      message: "Binding D1 belum tersedia di environment ini."
    });
  }

  const order = await context.env.DB.prepare(
    `SELECT order_id, payment_status, payment_amount, base_amount, product_name, created_at, updated_at
     FROM orders
     WHERE order_id = ?`
  )
    .bind(orderId)
    .first();

  if (!order) {
    return json({ message: "Order tidak ditemukan." }, 404);
  }

  return json({
    order_id: order.order_id,
    status: String(order.payment_status || "PENDING").toLowerCase(),
    payment_status: order.payment_status,
    amount: order.payment_amount ?? order.base_amount,
    package_label: order.product_name,
    product_name: order.product_name,
    created_at: order.created_at,
    updated_at: order.updated_at
  });
}

export function onRequestPost() {
  return json({ message: "Gunakan metode GET untuk cek status." }, 405);
}
