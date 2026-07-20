# Cashi QRIS Checkout

Website checkout QRIS untuk produk Nutriflakes. Project ini memakai HTML, CSS, JavaScript vanilla, Cloudflare Pages Functions, dan Cloudflare D1.

API key, token, dan secret Cashi tidak boleh disimpan di source code, `wrangler.jsonc`, atau GitHub.

## Struktur

```text
public/
  index.html
  checkout.html
  sukses.html
  gagal.html
  css/style.css
  js/app.js
  js/checkout.js
  js/success.js
functions/
  api/create-order.js
  api/check-status.js
  api/health.js
  api/webhook/cashi.js
migrations/
  0001_create_orders.sql
  0002_add_client_request_id.sql
  0003_create_webhook_events.sql
scripts/
  sign-webhook.mjs
tests/
  create-order.test.mjs
  check-status.test.mjs
  frontend-flow.test.mjs
  webhook-cashi.test.mjs
wrangler.jsonc
package.json
```

## Fitur Saat Ini

- Form checkout membuat order melalui `POST /api/create-order`.
- Harga produk ditentukan di backend, bukan dari browser.
- Idempotency create order memakai `client_request_id`.
- Halaman `/checkout.html?order_id=...` mengambil detail pembayaran dari backend.
- QRIS, nominal unik, countdown, dan status pembayaran ditampilkan dari `GET /api/check-status`.
- Polling berhenti ketika status `PAID`, `EXPIRED`, atau `PAYMENT_FAILED`.
- Halaman `/sukses.html?order_id=...` hanya menampilkan sukses jika backend mengembalikan `PAID`.
- Webhook `POST /api/webhook/cashi` memverifikasi signature Cashi dan mengubah order `PENDING` menjadi `PAID` secara idempotent.

## Status Pembayaran

- `PENDING`: menunggu pembayaran.
- `PAID`: pembayaran berhasil.
- `PAYMENT_FAILED`: pembayaran QRIS belum dapat dibuat.
- `EXPIRED`: waktu pembayaran habis.

Status `PAID` production diperbarui oleh webhook Cashi setelah Cashi mengirim event `PAYMENT_SETTLED`.

## Secret Cloudflare

Buat secret berikut di Cloudflare Pages:

```powershell
npx.cmd wrangler@latest pages secret put CASHI_API_KEY
npx.cmd wrangler@latest pages secret put CASHI_WEBHOOK_SECRET --project-name cashi-qris-checkout
```

`ALLOWED_ORIGIN` tidak wajib untuk request dari domain Pages yang sama. Jika perlu mengizinkan origin tambahan, isi dengan origin website production, misalnya:

```text
https://nama-project.pages.dev
```

```powershell
npx.cmd wrangler@latest pages secret put ALLOWED_ORIGIN
```

## Perintah Windows PowerShell

Jalankan semua perintah dari folder project. Gunakan `npx.cmd` agar PowerShell tidak menjalankan file `.ps1`.

Login Wrangler:

```powershell
npx.cmd wrangler login
```

Buat database D1 production jika belum ada:

```powershell
npx.cmd wrangler d1 create cashi-qris-checkout-db
```

Jika database sudah dibuat, jangan ganti `database_id` di `wrangler.jsonc` kecuali nilainya memang masih placeholder.

Jalankan migration lokal:

```powershell
npx.cmd wrangler d1 migrations apply cashi-qris-checkout-db --local
```

Jalankan migration remote/production:

```powershell
npx.cmd wrangler d1 migrations apply cashi-qris-checkout-db --remote
```

Memeriksa tabel dan index lokal:

```powershell
npx.cmd wrangler d1 execute cashi-qris-checkout-db --local --command "SELECT name, sql FROM sqlite_master WHERE type IN ('table','index') AND tbl_name = 'orders';"
```

Menjalankan Pages Dev:

```powershell
npx.cmd wrangler pages dev public --port 8788
```

## Mock Cashi Lokal

Untuk menguji tanpa credential asli, buat `.dev.vars` lokal yang tidak dicommit:

```text
CASHI_API_KEY=test_api_key
ALLOWED_ORIGIN=http://127.0.0.1:8788
CASHI_MOCK_MODE=success
CASHI_WEBHOOK_SECRET=test_webhook_secret
```

Nilai `CASHI_MOCK_MODE=success` membuat endpoint mengembalikan respons Cashi tiruan. Gunakan `CASHI_MOCK_MODE=failure` untuk menguji jalur gagal.

Jalankan test otomatis:

```powershell
npm.cmd test
```

Jalankan test webhook saja:

```powershell
npm.cmd run test:webhook
```

## Membuat Order Lewat API Lokal

```powershell
$body = @{
  customer_name = "Budi Santoso"
  phone = "081234567890"
  address = "Jl. Melati No. 10"
  product_code = "NF-1"
  client_request_id = [guid]::NewGuid().ToString()
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://127.0.0.1:8788/api/create-order" -Method Post -ContentType "application/json" -Body $body
```

Respons sukses akan berisi `order_id`. Buka halaman checkout lokal dengan format:

```powershell
Start-Process "http://127.0.0.1:8788/checkout.html?order_id=NF-20260718-MOCK01"
```

## Membuat Mock Order Manual

Gunakan ini jika ingin menguji checkout tanpa memanggil create order:

```powershell
$sql = @"
INSERT INTO orders (
  order_id, client_request_id, customer_name, phone, address, product_code,
  product_name, quantity, base_amount, payment_amount, payment_status,
  checkout_url, qr_url, expires_at, created_at, updated_at
) VALUES (
  'NF-20260718-MOCK01', 'stage4-mock-01', 'Mock Buyer', '6281234567890',
  'Jl. Mock No. 1', 'NF-1', 'Nutriflakes 1 Box', 1, 1000, 1023,
  'PENDING', 'https://cashi.id/pay/NF-20260718-MOCK01',
  'data:image/png;base64,iVBORw0KGgo=', '2026-07-18 23:59:00',
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
) ON CONFLICT(order_id) DO UPDATE SET
  payment_status = 'PENDING',
  payment_amount = 1023,
  checkout_url = 'https://cashi.id/pay/NF-20260718-MOCK01',
  qr_url = 'data:image/png;base64,iVBORw0KGgo=',
  expires_at = '2026-07-18 23:59:00',
  updated_at = CURRENT_TIMESTAMP;
"@

npx.cmd wrangler d1 execute cashi-qris-checkout-db --local --command $sql
```

## Memeriksa Status Order

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:8788/api/check-status?order_id=NF-20260718-MOCK01"
```

Respons `check-status` hanya mengembalikan data publik:

```json
{
  "success": true,
  "order_id": "NF-20260718-MOCK01",
  "product_name": "Nutriflakes 1 Box",
  "quantity": 1,
  "base_amount": 1000,
  "payment_amount": 1023,
  "payment_status": "PENDING",
  "checkout_url": "https://cashi.id/pay/NF-20260718-MOCK01",
  "qr_url": "data:image/png;base64,...",
  "expires_at": "2026-07-18 23:59:00",
  "paid_at": null
}
```

## Webhook Cashi

URL webhook production:

```text
https://SUBDOMAIN/api/webhook/cashi
```

Ganti `SUBDOMAIN` dengan domain Cloudflare Pages production.

Event pembayaran berhasil yang diterima:

```json
{
  "event": "PAYMENT_SETTLED",
  "data": {
    "order_id": "NF-20260718-ABC123",
    "amount": 1023,
    "status": "SETTLED",
    "paid_at": "2026-07-18 10:20:00"
  }
}
```

Webhook membaca raw body, memverifikasi header `x-gateway-signature` dengan HMAC SHA-256 dan secret `CASHI_WEBHOOK_SECRET`, lalu mencocokkan `amount` dengan `payment_amount` di database sebelum menandai order sebagai `PAID`.

Menjalankan migration 0003 lokal:

```powershell
npx.cmd wrangler d1 migrations apply cashi-qris-checkout-db --local
```

Menjalankan migration 0003 remote/production:

```powershell
npx.cmd wrangler d1 migrations apply cashi-qris-checkout-db --remote
```

Memeriksa tabel webhook lokal:

```powershell
npx.cmd wrangler d1 execute cashi-qris-checkout-db --local --command "SELECT name, sql FROM sqlite_master WHERE type IN ('table','index') AND name LIKE '%webhook_events%';"
```

Membuat payload test dan signature dari file UTF-8 tanpa BOM:

```powershell
$payload = '{"event":"PAYMENT_SETTLED","data":{"order_id":"NF-20260718-MOCK01","amount":1023,"status":"SETTLED","paid_at":"2026-07-18 10:20:00"}}'
[System.IO.File]::WriteAllText(
  (Join-Path (Get-Location) "webhook-payload.json"),
  $payload,
  [System.Text.UTF8Encoding]::new($false)
)

$signature = node .\scripts\sign-webhook.mjs --secret test_webhook_secret --file .\webhook-payload.json
```

Mengirim webhook lokal dengan signature valid:

```powershell
curl.exe -sS `
  -X POST "http://127.0.0.1:8788/api/webhook/cashi" `
  -H "Content-Type: application/json" `
  -H "x-gateway-signature: $signature" `
  --data-binary "@webhook-payload.json"
```

Memastikan order berubah menjadi `PAID`:

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:8788/api/check-status?order_id=NF-20260718-MOCK01"
```

Menguji webhook duplikat:

```powershell
curl.exe -sS `
  -X POST "http://127.0.0.1:8788/api/webhook/cashi" `
  -H "Content-Type: application/json" `
  -H "x-gateway-signature: $signature" `
  --data-binary "@webhook-payload.json"
```

Request duplikat yang payload dan signature-nya sama tetap mengembalikan `success: true` tanpa update order kedua.

## Menguji Halaman Sukses Lokal

Ubah mock order menjadi `PAID`:

```powershell
npx.cmd wrangler d1 execute cashi-qris-checkout-db --local --command "UPDATE orders SET payment_status = 'PAID', paid_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE order_id = 'NF-20260718-MOCK01';"
```

Buka halaman sukses:

```powershell
Start-Process "http://127.0.0.1:8788/sukses.html?order_id=NF-20260718-MOCK01"
```

Jika status masih `PENDING`, halaman sukses akan mengarahkan pengguna kembali ke checkout.

## Deploy Cloudflare Pages

Contoh deploy manual:

```powershell
npx.cmd wrangler pages project create cashi-qris-checkout
npx.cmd wrangler pages deploy public --project-name cashi-qris-checkout
```

Untuk deploy via GitHub, hubungkan repository ini ke Cloudflare Pages dan gunakan:

```text
Build command: kosong
Build output directory: public
```

## Catatan Keamanan

- Jangan commit `.dev.vars`, API key, token, atau credential.
- Secret production harus disimpan melalui Cloudflare dashboard atau perintah secret Wrangler.
- Jangan menaruh webhook secret production di `wrangler.jsonc`, `.dev.vars` yang dikomit, README, atau frontend.
- Query D1 memakai prepared statement dan parameter binding.
- Respons API tidak mengembalikan API key, `customer_name`, `phone`, `address`, `client_request_id`, `cashi_payload`, stack trace, atau detail internal Cloudflare.
- QR URL frontend hanya menerima `data:image/png;base64`, `data:image/jpeg;base64`, atau HTTPS.
- Checkout URL frontend hanya menerima HTTPS dari `cashi.id` atau subdomainnya.
- Webhook Cashi tidak mencetak secret, signature lengkap, payload mentah, nomor telepon, alamat, atau QR data ke log.
