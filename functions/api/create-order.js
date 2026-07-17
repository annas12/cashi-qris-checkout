const PACKAGE_CATALOG = {
  "nf-1": {
    label: "Paket 1 Box",
    amount: 149000
  },
  "nf-2": {
    label: "Paket 2 Box",
    amount: 279000
  },
  "nf-3": {
    label: "Paket 3 Box",
    amount: 399000
  }
};

function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store"
    }
  });
}

function normalizeWhatsapp(value) {
  return String(value || "").replace(/[^\d+]/g, "").replace(/^(\+62|62)/, "0");
}

function validateOrder(payload) {
  const fullName = String(payload.fullName || "").trim();
  const whatsapp = normalizeWhatsapp(payload.whatsapp);
  const address = String(payload.address || "").trim();
  const packageId = String(payload.packageId || "").trim();
  const selectedPackage = PACKAGE_CATALOG[packageId];
  const errors = {};

  if (fullName.length < 3) errors.fullName = "Nama lengkap minimal 3 karakter.";
  if (!/^08\d{8,13}$/.test(whatsapp)) errors.whatsapp = "Nomor WhatsApp tidak valid.";
  if (address.length < 12) errors.address = "Alamat terlalu singkat.";
  if (!selectedPackage) errors.packageId = "Paket tidak tersedia.";

  return {
    errors,
    value: {
      fullName,
      whatsapp,
      address,
      packageId,
      packageLabel: selectedPackage?.label,
      amount: selectedPackage?.amount
    }
  };
}

export async function onRequestPost(context) {
  let payload;

  try {
    payload = await context.request.json();
  } catch (error) {
    return json({ message: "Body harus berupa JSON yang valid." }, 400);
  }

  const { errors, value } = validateOrder(payload);

  if (Object.keys(errors).length > 0) {
    return json({ message: "Data pesanan belum valid.", errors }, 400);
  }

  const orderId = `ORD-${Date.now()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const createdAt = new Date().toISOString();

  if (context.env.DB) {
    await context.env.DB.prepare(
      `INSERT INTO orders (
        id,
        full_name,
        whatsapp,
        address,
        package_id,
        package_label,
        amount,
        status,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        orderId,
        value.fullName,
        value.whatsapp,
        value.address,
        value.packageId,
        value.packageLabel,
        value.amount,
        "pending",
        createdAt,
        createdAt
      )
      .run();
  }

  return json(
    {
      order_id: orderId,
      status: "pending",
      package: {
        id: value.packageId,
        label: value.packageLabel,
        amount: value.amount
      },
      payment: {
        method: "QRIS",
        provider: "Cashi",
        qris_ready: false,
        message: "Integrasi API Cashi belum diaktifkan pada tahap ini."
      }
    },
    201
  );
}

export function onRequestGet() {
  return json({ message: "Gunakan metode POST untuk membuat order." }, 405);
}
