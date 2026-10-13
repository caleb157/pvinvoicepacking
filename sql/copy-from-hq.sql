-- Optional: carry the customs rates and remembered packing details over from HQ.
-- 1) Run this query in HQ's database (Lovable Cloud → Database → SQL).
-- 2) Copy the single text cell it returns and run that in the Neon SQL editor.
-- Safe to repeat: packing rows upsert by SKU, rates are skipped if already present.
SELECT string_agg(stmt, E'\n') FROM (
  SELECT format(
    'INSERT INTO customs_exchange_rates (currency, rate, notification_no, effective_from, source_url, created_by, created_at) '
    'SELECT %L, %s, %L, %L, %L, ''HQ'', %L WHERE NOT EXISTS (SELECT 1 FROM customs_exchange_rates WHERE currency = %L AND effective_from = %L AND rate = %s);',
    currency, rate, notification_no, effective_from, source_url, created_at, currency, effective_from, rate) AS stmt
  FROM public.customs_exchange_rates
  UNION ALL
  SELECT format(
    'INSERT INTO export_packing_profiles (sku, units_per_package, package_dims_in, package_kind, net_weight_kg, gross_weight_kg, updated_by, updated_at) '
    'VALUES (%L, %L, %L, %L, %L, %L, ''HQ'', %L) ON CONFLICT (sku) DO NOTHING;',
    sku, units_per_package, package_dims_in, package_kind, net_weight_kg, gross_weight_kg, updated_at)
  FROM public.export_packing_profiles
) s;
