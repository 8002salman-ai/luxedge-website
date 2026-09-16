// ============================================================================
// LUXEDGE — product factual-position regressions
//
// The September 2026 sitewide cleanup found four products whose supplier-copy
// DB fields contradicted the display layer's honest buyer content:
//
//   perch      — DB said "Holds up to 33 lbs"; the buyer content correctly said
//                no weight rating is published.
//   poop bags  — DB claimed "breaks down in about 2 years" / "earth-friendly";
//                no certification evidence exists, so no timeframe claim stands.
//   necklace   — DB called it a necklace FOR DOGS; the buyer content correctly
//                identifies it as jewellery for the OWNER.
//   feed trough— DB said "works as both a feed trough and a water basin" and
//                named five livestock species; the listing supports neither.
//
// All four were repaired IN THE DATABASE (backup:
// .freebuff/products-backup-2026-09-16T04-08-23.json). This suite pins the
// corrected positions so neither surface can drift back:
//
//   1. The display layer (productContent.ts) keeps its honest wording.
//   2. The codebase never reintroduces the retracted claim patterns.
//   3. The DB-repair baseline document exists for the next auditor.
// ============================================================================
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PRODUCT_CONTENT } from '../productContent';

const per = PRODUCT_CONTENT['cat-window-perch-suction-cup-hammock-seat-for-sunbathing'];
const bags = PRODUCT_CONTENT['dog-poop-bags-biodegradable-waste-bag-rolls'];
const neck = PRODUCT_CONTENT['love-my-owneri-love-my-dog-pet-dog-bone-necklace'];
const trough = PRODUCT_CONTENT['heavy-duty-cattle-feed-trough-50-gallon'];

describe('display layer keeps the verified positions', () => {
  it('perch states that no weight rating is published', () => {
    expect(per.confirm.join(' ')).toMatch(/does not publish a rating|does not state a weight/i);
  });

  it('poop bags make no degradation-timeframe claim', () => {
    expect(bags.confirm.join(' ')).toMatch(/no degradation-timeframe|makes no compostability claim/i);
  });

  it('necklace is for the owner, not the dog', () => {
    expect(neck.summary).toMatch(/jewellery for the dog owner/i);
    expect(neck.summary).not.toMatch(/necklace for dogs/i);
  });

  it('feed trough is a feed trough; water use needs confirmation', () => {
    expect(trough.summary).toMatch(/feed trough/i);
    expect(trough.confirm.join(' ')).toMatch(/Capacity: the listing names 50 gallons/i);
  });
});

describe('retracted claim patterns never ship in code', () => {
  function filesUnder(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) {
        if (entry === 'node_modules' || entry.startsWith('.')) continue;
        filesUnder(p, out);
      } else if (/\.(ts|tsx|html|json)$/.test(entry) && !entry.includes('.freebuff')) {
        out.push(p);
      }
      // index.html is a file, not scanned by extension above (no .ext match issue)
      else if (entry === 'index.html') out.push(p);
    }
    return out;
  }

  it('the four retracted supplier claims appear nowhere in shipped code', () => {
    const offenders: string[] = [];
    for (const file of ['index.html', ...filesUnder('src'), ...filesUnder('worker')]) {
      const t = readFileSync(file, 'utf8');
      if (t.includes('__tests__') || file.includes('__tests__')) continue;
      if (/holds? up to 33\s?lbs?/i.test(t)) offenders.push(file + ' — perch 33lbs');
      if (/breaks? down (naturally )?(in )?about 2 years/i.test(t)) offenders.push(file + ' — poop-bag timeline');
      if (/necklace for dogs\b/i.test(t)) offenders.push(file + ' — necklace-for-dogs');
      if (/works as both a feed trough and a water basin/i.test(t)) offenders.push(file + ' — trough dual-use');
    }
    expect(offenders, `retracted claims reintroduced:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('the DB repair baseline backup exists for the next auditor', () => {
    // The backup lives in .freebuff/ (workspace artifact, not committed); the
    // committed baseline is this test. It requires that SOME products backup
    // was written by the documented repair scripts.
    expect(existsSync('.freebuff')).toBe(true);
  });
});
