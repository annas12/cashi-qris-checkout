# Agent Notes

## Project

Cashi QRIS Checkout is a vanilla HTML, CSS, and JavaScript website for a Nutriflakes checkout flow. It is designed for Cloudflare Pages, Pages Functions, and D1.

## Rules

- Do not add a frontend framework unless the user explicitly asks for one.
- Do not commit API keys, Cashi credentials, webhook secrets, `.env`, or `.dev.vars`.
- Keep public assets inside `public/`.
- Keep backend endpoints inside `functions/`.
- Use prepared statements for every D1 query.
- Keep `wrangler.jsonc` as the deployment configuration source of truth.
- Update D1 schema through files in `migrations/`.

## Local Commands

```bash
npx wrangler d1 migrations apply cashi-qris-checkout-db --local
npx wrangler pages dev public
```
