/**
 * Risk-pattern claim scanner for static/fallback editorial content.
 *
 * The static blog fallback (INIT_BLOGS in src/App.tsx and the generated
 * public/blog-seo.json) must stay in the lane it can support: general
 * product-use information — not veterinary, medical, or safety guarantees.
 *
 * Instead of a fixed phrase denylist, this module flags *patterns* of
 * unsupported claims across every editorial field (excerpt / content / FAQ),
 * so a new or reworded post ("safe for cats", "reduces anxiety",
 * "supports joints") is caught by the scan in adsense-readiness.test.ts on
 * the next test run — no per-phrase maintenance.
 *
 * Deliberately NOT flagged (honest, AdSense-safe copy):
 *   - disclaimers ("does not claim", "is not a medicine", "not a substitute")
 *   - vet/qualified-professional referrals ("ask your vet", "if you notice…")
 *   - risk education ("fast eating can cause bloating", "warning signs")
 * A sentence is skipped entirely when it carries one of the CLAIM_GUARD
 * markers.
 *
 * The softened copy is committed as the single source of truth: INIT_BLOGS
 * and blog-seo.json ship pre-softened, and nothing rewrites editorial copy
 * at runtime (see src/content/__tests__/adsense-readiness.test.ts, which
 * scans both sources).
 */

/** Condition/outcome nouns that turn a claim verb into a health claim. */
const CONDITIONS =
  '(?:' +
  'condition(?:s)?|disease(?:s)?|illness(?:es)?|infection(?:s)?|symptom(?:s)?|' +
  'pain|arthritis|inflammat(?:ion|ory)|bloating|dehydration|anxiety|stress|' +
  'allerg(?:y|ies)|asthma|stone(?:s)?|thrush|bruising|deficienc(?:y|ies)|' +
  'parasite(?:s)?|worm(?:s)?|tick(?:s)?|flea(?:s)?|germ(?:s)?|bacteria|virus(?:es)?|' +
  'overeating|hot spots?|skin (?:issue(?:s)?|problem(?:s)?|condition(?:s)?)|' +
  'digestive (?:issue(?:s)?|problem(?:s)?)|urinary (?:issue(?:s)?|problem(?:s)?|tract)|' +
  'joint (?:pain|issue(?:s)?|problem(?:s)?|stiffness)|kidney (?:disease|issue(?:s)?)|' +
  'dental (?:disease|issue(?:s)?)|cancer(?:s)?|tumor(?:s)?|seizure(?:s)?|' +
  'depression|fatigue' +
  ')';

export interface RiskClaimPattern {
  /** Human-readable label used in scan output. */
  label: string;
  /** Case-insensitive pattern matched against a single sentence. */
  pattern: RegExp;
}

export const RISK_CLAIM_PATTERNS: ReadonlyArray<RiskClaimPattern> = [
  {
    label: 'cures/treats/prevents a condition',
    // Article group + "long list of" bridge claim verbs to the condition noun
    // (e.g. "prevents a long list of deficiency problems").
    pattern: new RegExp(
      `\\b(?:cures?|treats?|prevents?|heals?|eliminates?|reverses?)\\s+(?:(?:a|the|any|all|further|serious)\\s+)?(?:long\\s+list\\s+of\\s+)?${CONDITIONS}\\b`,
      'i',
    ),
  },
  {
    label: 'joint-support claim',
    pattern: /\bsupport(?:s|ing)?\s+(?:(?:healthy|growing|aging|senior|large|sore)\s+)?joints?\b|\bjoint[- ]support(?:ing|ive)?\b/i,
  },
  {
    label: 'safe-to-consume guarantee',
    pattern: /\bsafe to\s+(?:chew|eat|lick|ingest|use|give|consume)\b/i,
  },
  {
    label: 'safe-for-audience guarantee',
    pattern: /\bsafe for\s+(?:puppies|kittens|seniors?|pets|dogs|cats|horses|children|babies)\b/i,
  },
  {
    label: 'non-toxic material claim',
    pattern: /\bnon-?toxic\b/i,
  },
  {
    label: 'chew-resistant safety claim',
    pattern: /\bchew-?resistant\b/i,
  },
  {
    label: 'reduces stress/anxiety claim',
    pattern: /\breduc(?:es|ing|ed)\s+(?:stress|anxiety|fear)\b/i,
  },
  {
    label: 'behavioral-outcome claim',
    pattern: /\bfewer\s+behavior(?:al|oural)\s+problems?\b/i,
  },
  {
    label: 'FDA / regulatory claim',
    pattern: /\bFDA[- ](?:approved|registered|cleared)\b/i,
  },
  {
    label: 'veterinarian-endorsement claim',
    pattern: /\b(?:veterinarian|vet)[- ](?:recommended|approved|tested)\b/i,
  },
  {
    label: 'health-outcome guarantee',
    pattern: /\bguarantee(?:s|d)?\s+(?:to\s+)?(?:prevent|treat|cure|heal|relieve|improve)\b|\bguaranteed\s+(?:results?|health|relief|outcomes?)\b/i,
  },
  {
    label: 'constant-hydration claim',
    pattern: /\bconstant hydration\b|\bprevents?\s+dehydration\b/i,
  },
  {
    label: 'proven-effect claim',
    pattern: /\bproven\s+(?:tricks?|methods?|way|formula|remedies?)\b/i,
  },
  {
    label: 'dental-cleaning claim',
    pattern: /\bclean(?:s|ing)?\s+(?:teeth|gums)\b|\bremoves?\s+(?:plaque|tartar)\b/i,
  },
  {
    label: 'relieves pain claim',
    pattern: /\breliev(?:es|ing|ed)?\s+(?:pain|aching|itch(?:ing)?|soreness|discomfort)\b/i,
  },
];

/**
 * Sentence-level guards: a sentence containing any of these markers is a
 * disclaimer, a qualified-professional referral, or honest risk education —
 * not an unsupported claim — and is skipped.
 */
const CLAIM_GUARD = new RegExp(
  String.raw`\b(?:` +
    'does not claim|do not claim|makes no claim|no (?:medical|health|safety) claim|' +
    'is not a (?:medicine|treatment|cure|substitute|replacement)|never a substitute|' +
    'not a (?:medicine|treatment|cure|substitute|replacement)|not medical advice|' +
    "cannot (?:prevent|treat|cure)|can['\u2019]t (?:prevent|treat|cure)|won['\u2019]t (?:prevent|treat|cure)|" +
    'check with your (?:vet|veterinarian)|ask your (?:vet|veterinarian|farrier)|' +
    'consult (?:your|a|the)?\\s*(?:vet|veterinarian|nutritionist)|' +
    'contact your (?:vet|veterinarian)|see your (?:vet|veterinarian)|visit your (?:vet|veterinarian)|' +
    'if you (?:notice|see|suspect|are worried|are concerned)|warning signs|veterinary emergency' +
    String.raw`)\b`,
  'i',
);

export interface EditorialClaimHit {
  slug: string;
  field: 'excerpt' | 'content' | 'faq';
  label: string;
  sentence: string;
}

export interface ScannableEditorial {
  slug?: string;
  excerpt?: string;
  content?: string;
  faq?: { q?: string; a?: string }[];
}

function sentencesOf(text: string): string[] {
  return text
    .split(/(?<=[.!?\n])\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Drop markdown link destinations so product-URL slugs never trigger patterns. */
const STRIP_MD_LINKS = /\[([^\]]*)\]\([^)]*\)/g;

/** Scan one block of text; returns label + offending sentence per hit. */
export function scanEditorialText(text: string): { label: string; sentence: string }[] {
  const hits: { label: string; sentence: string }[] = [];
  for (const raw of sentencesOf(text)) {
    if (CLAIM_GUARD.test(raw)) continue;
    // Match against the sentence with link URLs removed; report the original.
    const plain = raw.replace(STRIP_MD_LINKS, '$1');
    for (const { label, pattern } of RISK_CLAIM_PATTERNS) {
      if (pattern.test(plain)) hits.push({ label, sentence: raw.slice(0, 240) });
    }
  }
  return hits;
}

/** Scan every editorial field of one post. */
export function scanEditorialPost(post: ScannableEditorial): EditorialClaimHit[] {
  const slug = post.slug || '(unknown)';
  const hits: EditorialClaimHit[] = [];
  if (typeof post.excerpt === 'string') {
    for (const h of scanEditorialText(post.excerpt)) hits.push({ slug, field: 'excerpt', ...h });
  }
  if (typeof post.content === 'string') {
    for (const h of scanEditorialText(post.content)) hits.push({ slug, field: 'content', ...h });
  }
  if (Array.isArray(post.faq)) {
    for (const item of post.faq) {
      if (typeof item.q === 'string') {
        for (const h of scanEditorialText(item.q)) hits.push({ slug, field: 'faq', ...h });
      }
      if (typeof item.a === 'string') {
        for (const h of scanEditorialText(item.a)) hits.push({ slug, field: 'faq', ...h });
      }
    }
  }
  return hits;
}

/** Scan a full post list (e.g. blog-seo.json posts or INIT_BLOGS). */
export function scanAllEditorial(posts: ScannableEditorial[]): EditorialClaimHit[] {
  return posts.flatMap(scanEditorialPost);
}