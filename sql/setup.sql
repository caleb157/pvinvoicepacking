-- Shipping Documents app: its own database (Neon Postgres via Vercel → Storage).
-- Run in the Neon SQL editor. Safe to run again: it only creates what is missing.

-- People who can sign in (added by an admin in Settings). The first admin signs in
-- with ADMIN_EMAIL / ADMIN_PASSWORD from the Vercel environment variables.
CREATE TABLE IF NOT EXISTS app_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  name text NOT NULL DEFAULT '',
  password_hash text NOT NULL,
  is_admin boolean NOT NULL DEFAULT false,
  disabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- App settings (LUT ARN and dates, AD code, ...), one row per key.
CREATE TABLE IF NOT EXISTS app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Customs exchange rates notified on ICEGATE; the latest per currency pre-fills documents.
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

-- Packing details per internal SKU, remembered from the last packing list.
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

-- One working document set per Odoo invoice or sales order (invoice + packing list
-- as edited), so labels and letters always match the saved packing list.
CREATE TABLE IF NOT EXISTS shipments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_kind text NOT NULL CHECK (source_kind IN ('invoice', 'order')),
  source_name text NOT NULL,
  odoo_id integer,
  invoice_no text,
  payload jsonb NOT NULL,
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_kind, source_name)
);

-- Shipping bill tracker (one row per shipping bill).
CREATE TABLE IF NOT EXISTS shipping_bills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sb_number text,
  sb_date date,
  port_code text,
  invoice_no text,
  invoice_date date,
  odoo_invoice_id integer,
  taxable_value_inr numeric,
  currency text DEFAULT 'USD',
  consignee text,
  buyer text,
  fob_value numeric,
  freight_value numeric,
  insurance_value numeric,
  transport_doc_no text,
  transport_doc_date date,
  ebrc_date date,
  bank_submitted_date date,
  bank_status text DEFAULT 'Not Submitted',
  status text DEFAULT 'In Progress',
  comments text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS shipping_bills_invoice_idx ON shipping_bills (invoice_no);

-- Inward remittances (bank credit advices).
CREATE TABLE IF NOT EXISTS inward_remittances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  remittance_no text,
  value_date date,
  currency text,
  fcy_amount numeric,
  exchange_rate numeric,
  inr_amount numeric,
  remitter text,
  remitting_bank text,
  purpose_code text,
  comments text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS inward_remittances_no_idx ON inward_remittances (remittance_no) WHERE remittance_no IS NOT NULL AND remittance_no <> '';

-- How much of each inward remittance is used against each invoice (HDFC regularization letter).
-- One row per remittance + invoice; the unused balance is the remittance amount minus these rows.
CREATE TABLE IF NOT EXISTS remittance_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  remittance_id uuid NOT NULL REFERENCES inward_remittances(id) ON DELETE CASCADE,
  invoice_no text NOT NULL,
  amount numeric NOT NULL CHECK (amount > 0),
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (remittance_id, invoice_no)
);
CREATE INDEX IF NOT EXISTS remittance_allocations_invoice_idx ON remittance_allocations (invoice_no);
