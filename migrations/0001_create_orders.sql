CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  whatsapp TEXT NOT NULL,
  address TEXT NOT NULL,
  package_id TEXT NOT NULL,
  package_label TEXT NOT NULL,
  amount INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed', 'expired')),
  provider TEXT NOT NULL DEFAULT 'cashi',
  provider_reference TEXT,
  raw_payload TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_whatsapp ON orders(whatsapp);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
