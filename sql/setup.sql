-- Invoice & Packing List app: its own small database (Neon Postgres via Vercel → Storage).
-- Run once in the Neon SQL editor. Safe to run again: it only creates what is missing.

-- Customs exchange rates notified on ICEGATE, entered when a new notification is
-- published. The latest row per currency pre-fills the app.
CREATE TABLE IF NOT EXISTS customs_exchange_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  currency text NOT NULL DEFAULT 'USD',
  rate numeric NOT NULL CHECK (rate > 0),
  notification_no text,
  effective_from date NOT NULL DEFAULT current_date,
  source_url text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS customs_exchange_rates_currency_from_idx
  ON customs_exchange_rates (currency, effective_from DESC, created_at DESC);

-- Packing details per SKU (the Odoo product's internal reference), remembered from
-- the last packing list so the next one pre-fills.
CREATE TABLE IF NOT EXISTS export_packing_profiles (
  sku text PRIMARY KEY,
  units_per_package numeric,
  package_dims_in text,
  package_kind text,
  net_weight_kg numeric,
  gross_weight_kg numeric,
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- A copy of every generated invoice + packing list set.
CREATE TABLE IF NOT EXISTS export_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_no text NOT NULL,
  odoo_invoice_id integer,
  exchange_rate numeric,
  notification_no text,
  total_usd numeric,
  payload jsonb NOT NULL,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS export_documents_invoice_idx ON export_documents (invoice_no, created_at DESC);
