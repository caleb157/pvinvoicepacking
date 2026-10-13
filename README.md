# Shipping Documents (Parable Ventures)

A standalone app for export paperwork. It reads Odoo live with one server-side API key, so
people who use it don't need Odoo accounts.

- **Documents:** pick a posted Odoo invoice (or a confirmed sales order for a DRAFT set), edit
  the Commercial Invoice (IGST paid or under LUT) and the Packing List, and download Excel
  (INV262700015 layout) or PDF. Product codes use the customer SKU from the variant's tags,
  else the internal SKU. Packing rows can be copied (to split a product over carton sizes),
  moved or removed; carton numbers follow the row order, and the app warns when packed
  quantities don't match the invoice. Gross weight starts as the Odoo product weight (the
  average gross weight per piece) × units per carton; net weight is typed; 0 kg is refused.
  Each edited set is saved per invoice / order.
- **Shipping bills:** the tracker, edited in place. "Add from Odoo invoice" fills the invoice
  number and date, consignee, buyer, FOB, freight and insurance.
- **Remittances:** inward remittances, edited in place. "Read remittance PDF" fills a row from
  HDFC's Certificate of Foreign Inward Remittance, read in the browser (no AI service).
- **Settings:** LUT ARN and dates, AD code, signatory; admins add the people who can sign in.

Coming next: A5 carton labels, Non-DG letter, Export Value Declaration and Wooden Declaration
on the letterhead, and the HDFC export regularization letter.

## How it's built

- Front end: Vite + React + Tailwind, same look as HQ (Inter, HQ theme tokens, light and dark).
- Server: Vercel Functions in `api/` (`auth`, `odoo`, `data`, `tracker`, `users`) with shared
  code in `server/`. Odoo is called over JSON-RPC; the key never reaches the browser.
- Sign-in: app passwords (scrypt hashes in `app_users`) plus the admin from `ADMIN_EMAIL` /
  `ADMIN_PASSWORD`, which works even before the database is set up. A signed cookie keeps
  people signed in for 30 days; removing or disabling someone signs them out at once.
- Data: a Neon Postgres database connected from Vercel → Storage. Tables come from
  `sql/setup.sql`, run once by hand (safe to re-run).
- Document math: `src/lib/export-docs.ts` (tested). Excel writer: `src/lib/xlsx-writer.ts`.
  Remittance PDF reader: `src/lib/remittance-pdf.ts` (tested).

## Setup

1. **Vercel:** Add New → Project → import this repository. Framework preset: Vite (detected).
2. **Database:** in the project, Storage → Create Database → Neon (free) → connect it. That adds
   `DATABASE_URL`. Open it in Neon's console → SQL editor and run `sql/setup.sql`. Optionally run
   `sql/copy-from-hq.sql` to bring HQ's customs rate and packing details over.
3. **Environment variables** (Settings → Environment Variables, all environments):

   | Name | Value |
   | --- | --- |
   | `ODOO_URL` | Your Odoo address, e.g. `https://yourcompany.odoo.com` |
   | `ODOO_DB` | Odoo database name (`parableventures`) |
   | `ODOO_USERNAME` | The Odoo user the app reads as |
   | `ODOO_API_KEY` | That user's API key |
   | `SESSION_SECRET` | Any long random string (`openssl rand -hex 32`) |
   | `ADMIN_EMAIL` | The first admin's email |
   | `ADMIN_PASSWORD` | The first admin's password (8+ characters) |

   The same Odoo values HQ uses will work. The app only reads Odoo.
4. Redeploy so the variables apply, sign in as the admin, and add people in Settings.

## Develop

```sh
npm install
npm test           # document math, PDF reader, sign-in, Odoo mapping, API with a fake Odoo
npm run typecheck
npx vercel dev     # front end and api/ together, using a local .env (see .env.example)
```
