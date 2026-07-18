function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store"
    }
  });
}

export async function onRequestGet(context) {
  try {
    const result = await context.env.DB.prepare("SELECT 1 AS health").first();

    if (!result || Number(result.health) !== 1) {
      throw new Error("Health query failed");
    }

    return json({
      success: true,
      database: "connected",
      service: "cashi-qris-checkout"
    });
  } catch (error) {
    return json(
      {
        success: false,
        database: "unavailable",
        service: "cashi-qris-checkout"
      },
      503
    );
  }
}

export function onRequestPost() {
  return json({ message: "Gunakan metode GET untuk health check." }, 405);
}
