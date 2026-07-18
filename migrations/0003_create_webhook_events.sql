CREATE TABLE IF NOT EXISTS webhook_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT UNIQUE NOT NULL,
  event_name TEXT NOT NULL,
  order_id TEXT,
  payload_hash TEXT NOT NULL,
  processing_status TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at TEXT,
  response_code INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_webhook_events_event_key ON webhook_events(event_key);
CREATE INDEX IF NOT EXISTS idx_webhook_events_order_id ON webhook_events(order_id);
CREATE INDEX IF NOT EXISTS idx_webhook_events_received_at ON webhook_events(received_at);
