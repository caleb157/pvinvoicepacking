# Invoice & Packing List

A standalone app that turns a posted Odoo customer invoice into the Commercial Invoice
and Packing List (Excel in the INV262700015 layout, plus PDFs). It reads Odoo live and
keeps only its own small data: the ICEGATE customs exchange rate, packing details per
SKU, and a copy of each generated set.

- **Front end:** Vite + React + Tailwind (same look as HQ: Inter, the HQ theme tokens, light and dark).
- **Server:** three Vercel Functions in `api/` (`auth`, `odoo`, `data`). Odoo is called over
  JSON-RPC with one API key held in Vercel environment variables; the browser never sees it.
- **Sign-in:** people use their own Odoo login (password, or an API key if they use two-step
  sign-in). Only internal Odoo users get in. A signed cookie keeps them signed in for 30 days.
- **Data:** a Neon Postgres database connected from Vercel → Storage. Tables come from
  `sql/setup.sql`, run once by hand.
- **Fallbacks:** packing details come from what was used last time for that SKU, else the
  Odoo product's packaging (units, package type size and empty weight). The shipper is the
  Odoo company on the invoice, and its Tax ID is the GSTIN.

All document math lives in `src/lib/export-docs.ts` (tested); the Excel writer is
`src/lib/xlsx-writer.ts`.

## Setup

1. **Vercel:** Add New → Project → import this repository. Framework preset: Vite (detected).
2. **Database:** in the new project, Storage → Create Database → Neon (free) → connect it to the
   project. That adds `DATABASE_URL`. Open the database in Neon's console, SQL editor, and run
   `sql/setup.sql`. Optionally run `sql/copy-from-hq.sql` to bring HQ's rate and packing details over.
3. **Environment variables** (Settings → Environment Variables, all environments):

   | Name | Value |
   | --- | --- |
   | `ODOO_URL` | Your Odoo address, e.g. `https://yourcompany.odoo.com` |
   | `ODOO_DB` | Odoo database name (`parableventures`) |
   | `ODOO_USERNAME` | The Odoo user the app reads as |
   | `ODOO_API_KEY` | That user's API key (Odoo → My Profile → Account Security → New API Key) |
   | `SESSION_SECRET` | Any long random string (`openssl rand -hex 32`) |

   The same Odoo values HQ's Lovable Cloud functions use will work. The app only reads Odoo.
4. Redeploy so the variables apply, open the site and sign in with your Odoo login.

## Develop

```sh
npm install
npm test           # document math, sign-in cookie, Odoo mapping, API with a fake Odoo
npm run typecheck
npx vercel dev     # runs the front end and api/ together, using a local .env (see .env.example)
```
