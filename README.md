# Cashi QRIS Checkout

Fondasi website checkout QRIS untuk landing page produk Nutriflakes. Project ini memakai HTML, CSS, JavaScript vanilla, Cloudflare Pages Functions, dan Cloudflare D1.

Endpoint `POST /api/create-order` sudah terhubung ke API Cashi melalui secret Cloudflare. Tidak ada API key, token, atau secret apa pun di source code.

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
  images/
functions/
  api/create-order.js
  api/check-status.js
  api/health.js
  api/webhook/cashi.js
migrations/
  0001_create_orders.sql
  0002_add_client_request_id.sql
tests/
  create-order.test.mjs
wrangler.jsonc
README.md
package.json
```

## Fitur Tahap Ini

- Form checkout berisi nama lengkap, nomor WhatsApp, alamat, dan pilihan paket.
- Harga produk ditentukan di backend, bukan dari browser.
- Endpoint `POST /api/create-order` membuat order D1 dan pembayaran QRIS Cashi.
- Endpoint `GET /api/check-status?order_id=...` untuk cek status.
- Endpoint sementara `GET /api/health` untuk memeriksa koneksi D1.
- Idempotency dengan `client_request_id` untuk mencegah order ganda saat klik ulang.
- CORS hanya mengizinkan origin dari `ALLOWED_ORIGIN`.
- Test mock Cashi tanpa credential asli.

## Secret Cloudflare

Buat secret berikut di Cloudflare Pages:

```powershell
npx.cmd wrangler@latest pages secret put CASHI_API_KEY
npx.cmd wrangler@latest pages secret put ALLOWED_ORIGIN
```

Isi `ALLOWED_ORIGIN` dengan origin website production, misalnya:

```text
https://nama-project.pages.dev
```

Jangan menaruh API key di `wrangler.jsonc`, `.dev.vars` yang ikut commit, source code, atau GitHub. `CASHI_WEBHOOK_SECRET` belum digunakan pada tahap ini; secret itu akan dipakai pada tahap webhook berikutnya.

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
```

Nilai `CASHI_MOCK_MODE=success` membuat endpoint mengembalikan respons Cashi tiruan. Gunakan `CASHI_MOCK_MODE=failure` untuk menguji jalur HTTP 502.

Jalankan test otomatis:

```powershell
npm.cmd run test:create-order
```

Contoh request lokal:

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

## Endpoint Create Order

Request:

```json
{
  "customer_name": "Nama pembeli",
  "phone": "081234567890",
  "address": "Alamat pembeli",
  "product_code": "NF-1",
  "client_request_id": "uuid-dari-browser"
}
```

Response sukses:

```json
{
  "success": true,
  "order_id": "NF-20260718-ABC123",
  "product_name": "Nutriflakes 1 Box",
  "quantity": 1,
  "base_amount": 95000,
  "payment_amount": 95023,
  "checkout_url": "https://cashi.id/pay/INV-9921",
  "qr_url": "data:image/png;base64,...",
  "expires_at": "2026-07-18 10:00:00"
}
```

Response gagal saat Cashi tidak tersedia:

```json
{
  "message": "Pembayaran belum dapat dibuat. Silakan coba kembali."
}
```

## Test Production Setelah Deploy

Setelah deploy dari GitHub selesai:

```powershell
$body = @{
  customer_name = "Budi Santoso"
  phone = "081234567890"
  address = "Jl. Melati No. 10"
  product_code = "NF-1"
  client_request_id = [guid]::NewGuid().ToString()
} | ConvertTo-Json

Invoke-RestMethod -Uri "https://DOMAIN-PRODUCTION/api/create-order" -Method Post -ContentType "application/json" -Body $body
```

Pastikan `CASHI_API_KEY`, `ALLOWED_ORIGIN`, dan migration `0002_add_client_request_id.sql` sudah diterapkan di Cloudflare sebelum test production.

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
- Query D1 memakai prepared statement dan parameter binding.
- Respons API tidak mengembalikan API key, `cashi_payload`, stack trace, atau detail internal Cloudflare.
- Webhook Cashi saat ini belum memverifikasi signature karena tahap webhook belum dimulai.
