import { describe, expect, it } from 'vitest';
import { customerSku, productCode } from './export-docs-data';

describe('customer SKU from Odoo variant tags', () => {
  it('prefers a tag marked SKU: and drops the prefix', () => {
    expect(customerSku(['Amazon', 'SKU: DKT-ASH-01'])).toBe('DKT-ASH-01');
    expect(customerSku(['sku-ABC 12'])).toBe('ABC 12');
  });
  it('uses a lone tag, but not one of several unmarked tags', () => {
    expect(customerSku(['DKT-ASH-01'])).toBe('DKT-ASH-01');
    expect(customerSku(['Amazon', 'Holiday'])).toBe('');
    expect(customerSku([])).toBe('');
  });
  it('falls back to our internal SKU', () => {
    expect(productCode({ customer_skus: ['Amazon', 'Holiday'], internal_sku: 'HYP-ASH-01' })).toBe('HYP-ASH-01');
  });
});
