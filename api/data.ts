// The app's own data for documents: settings, customs rate, packing details per SKU,
// saved shipments (the invoice + packing list as edited).
import { z } from 'zod';
import * as db from '../server/db.js';
import { json, signedIn } from '../server/http.js';

const Packing = z.object({
  sku: z.string().min(1).max(100), units_per_package: z.number().nullable(), package_dims_in: z.string().max(100).nullable(),
  package_kind: z.string().max(50).nullable(), net_weight_kg: z.number().nullable(), gross_weight_kg: z.number().nullable(),
});
const Kind = z.enum(['invoice', 'order']);

// Signature / company stamp for the letters: a small PNG or JPEG data URL, or '' for none.
const Image = z.string().max(400_000).regex(/^(data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+)?$/);

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('init') }),
  z.object({ action: z.literal('packing'), skus: z.array(z.string().max(100)).max(500) }),
  z.object({ action: z.literal('get-shipment'), kind: Kind, name: z.string().min(1).max(100) }),
  z.object({
    action: z.literal('save-rate'), currency: z.string().max(5), rate: z.number().positive(),
    notification_no: z.string().max(50), effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), source_url: z.string().max(300),
  }),
  z.object({
    action: z.literal('save-shipment'), kind: Kind, name: z.string().min(1).max(100), odoo_id: z.number().int().nullable(),
    invoice_no: z.string().max(100).nullable(), payload: z.record(z.unknown()), packing: z.array(Packing).max(500),
  }),
  z.object({
    action: z.literal('save-settings'),
    settings: z.object({
      lutArn: z.string().max(100), lutFrom: z.string().max(10), lutTo: z.string().max(10), adCode: z.string().max(50),
      signatoryName: z.string().max(100), signatoryTitle: z.string().max(100),
      signatureImage: Image, stampImage: Image,
    }).partial(),
  }),
]);

export function POST(req: Request) {
  return signedIn(req, async (s) => {
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return json({ error: 'Bad request' }, 400);
    const b = parsed.data;
    switch (b.action) {
      case 'init':
        return json({ rate: await db.latestRate('USD'), shipments: await db.listShipments(30), settings: await db.getSettings() });
      case 'packing':
        return json({ profiles: await db.packingProfiles([...new Set(b.skus.filter(Boolean))]) });
      case 'get-shipment':
        return json({ shipment: await db.getShipment(b.kind, b.name) });
      case 'save-rate':
        await db.saveRate(b, s.name);
        return json({ ok: true });
      case 'save-shipment':
        await db.saveShipment({ source_kind: b.kind, source_name: b.name, odoo_id: b.odoo_id, invoice_no: b.invoice_no, payload: b.payload }, s.name);
        await db.savePackingProfiles(b.packing, s.name);
        return json({ shipments: await db.listShipments(30) });
      case 'save-settings':
        if (!s.admin) return json({ error: 'Only an admin can change settings.' }, 403);
        await db.saveSettings(b.settings, s.name);
        return json({ settings: await db.getSettings() });
    }
  });
}
