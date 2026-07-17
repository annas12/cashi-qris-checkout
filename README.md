# Cashi QRIS Checkout

Fondasi website checkout QRIS untuk landing page produk Nutriflakes. Project ini memakai HTML, CSS, dan JavaScript vanilla untuk frontend, Cloudflare Pages Functions untuk backend, serta Cloudflare D1 untuk database order.

Integrasi API Cashi belum diaktifkan pada tahap ini. Tidak ada API key, token, atau secret apa pun di source code.

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
  api/webhook/cashi.js
migrations/
  0001_create_orders.sql
wrangler.jsonc
README.md
.gitignore
AGENTS.md
```

## Fitur Tahap Ini

- Landing page mobile-first untuk Nutriflakes.
- Form checkout berisi nama lengkap, nomor WhatsApp, alamat, dan pilihan paket.
- Validasi frontend dasar.
- Endpoint `POST /api/create-order` untuk membuat order awal.
- Endpoint `GET /api/check-status?order_id=...` untuk cek status.
- Endpoint `POST /api/webhook/cashi` sebagai placeholder webhook Cashi.
- Skema D1 untuk tabel `orders`.

## Menjalankan Lokal

Pastikan Node.js tersedia, lalu jalankan dari folder project:

```bash
npx wrangler d1 migrations apply cashi-qris-checkout-db --local
npx wrangler pages dev public
```

Buka:

```text
http://localhost:8788/
http://localhost:8788/checkout.html
http://localhost:8788/sukses.html
http://localhost:8788/gagal.html
```

Jika port lokal berbeda, ikuti URL yang ditampilkan Wrangler.

## Setup D1 Production

Buat database D1 di Cloudflare:

```bash
npx wrangler d1 create cashi-qris-checkout-db
```

Salin `database_id` dari output ke `wrangler.jsonc`, lalu jalankan migrasi production:

```bash
npx wrangler d1 migrations apply cashi-qris-checkout-db --remote
```

## Deploy Cloudflare Pages

Contoh deploy manual:

```bash
npx wrangler pages project create cashi-qris-checkout
npx wrangler pages deploy public --project-name cashi-qris-checkout
```

Untuk deploy via GitHub, hubungkan repository ini ke Cloudflare Pages dan gunakan:

```text
Build command: kosong
Build output directory: public
```

## Catatan Keamanan

- Jangan commit `.dev.vars`, API key, token, atau credential.
- Secret production harus disimpan melalui Cloudflare dashboard atau perintah secret Wrangler.
- Webhook Cashi saat ini belum memverifikasi signature karena secret belum tersedia.
