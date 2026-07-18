ALTER TABLE orders ADD COLUMN client_request_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_client_request_id ON orders(client_request_id);
