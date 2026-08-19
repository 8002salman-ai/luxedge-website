// TEMPORARY live activation driver — drives the REAL repository against the LIVE DB.
// Guarded by RUN_LIVE_ACTIVATE=1. Deleted after the run.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
function loadEnv() {
  const env: Record<string, string> = {};
  if (fs.existsSync(path.join(__dirname, '..', '.env'))) {
    for (const line of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  return env;
}
const env = loadEnv();
const RUN = process.env.RUN_LIVE_ACTIVATE === '1' && env.VITE_SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY;

describe.skipIf(!RUN)('LIVE catalog activation (RUN_LIVE_ACTIVATE=1)', () => {
  it('activates exactly the 14 standard-meeting products; keeps 5 draft', { timeout: 120000 }, async () => {
    const { __setDbConfigForTests } = await import('../src/services/db');
    const repo = await import('../src/features/catalog/repository');
    __setDbConfigForTests({ url: env.VITE_SUPABASE_URL!.replace(/\/$/, ''), anonKey: env.SUPABASE_SERVICE_ROLE_KEY! });

    const products = await repo.listProducts();
    const byName = new Map(products.map((p) => [p.name, p]));

    const ACTIVATE = [
      'Adjustable Car Seat Safety Leash for Pets',
      'Adjustable Dog Seat Belt Leash (2-Pack)',
      'Adjustable Dog Training Collar',
      'Bone-Shaped Dog Necklace',
      'Comfortable Everyday Dog Bed',
      'Dog Waste Bag Dispenser with Storage Box',
      'Lightweight Spring Dog Apparel',
      'Nylon Anti-Chew Dog Leash Collar',
      'Pet Carrier Backpack for Small Dogs',
      'Polka-Dot Turtleneck Dog Shirt',
      'Protective Dog Shoes',
      'Silicone Flying Disc Dog Toy',
      'Soft Cat Blanket / Pet Mat',
      'Waterproof Silicone Pet Placemat',
    ];
    const KEEP_DRAFT = [
      'Elevated Dog Sofa Bed (Black)',
      'Elevated Dog Sofa Bed (Light Grey)',
      'Elevated Dog Sofa Bed for Large Dogs',
      'Small Dog Bed with Hidden Storage',
      'KONG Classic, Durable Natural Rubber Dog Toy',
    ];

    let activated = 0;
    for (const name of ACTIVATE) {
      const p = byName.get(name);
      expect(p, `missing product: ${name}`).toBeTruthy();
      if (p && p.status !== 'active') {
        await repo.setProductStatus(p.id, 'active');
        activated += 1;
      }
    }
    let kept = 0;
    for (const name of KEEP_DRAFT) {
      const p = byName.get(name);
      expect(p, `missing product: ${name}`).toBeTruthy();
      if (p && p.status !== 'draft') {
        await repo.setProductStatus(p.id, 'draft');
        kept += 1;
      }
    }

    const after = await repo.listProducts();
    const active = after.filter((p) => p.status === 'active');
    const draft = after.filter((p) => p.status === 'draft');
    console.log(`ACTIVATED: ${activated} (now active: ${active.length}) | forced draft: ${kept} (now draft: ${draft.length}) | total: ${after.length}`);
    expect(active.length).toBe(14);
    expect(draft.length).toBe(5);
    expect(after.length).toBe(19);
  });
});
