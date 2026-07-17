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
    `SELECT id, status, amount, package_label, created_at, updated_at
     FROM orders
     WHERE id = ?`
  )
    .bind(orderId)
    .first();

  if (!order) {
    return json({ message: "Order tidak ditemukan." }, 404);
  }

  return json({
    order_id: order.id,
    status: order.status,
    amount: order.amount,
    package_label: order.package_label,
    created_at: order.created_at,
    updated_at: order.updated_at
  });
}

export function onRequestPost() {
  return json({ message: "Gunakan metode GET untuk cek status." }, 405);
}
