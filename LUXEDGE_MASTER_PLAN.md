# LUXEDGE V2 — MASTER PLAN / NORTH STAR

Status: Permanent project constitution

Development branch: `luxedge-v2`
Production branch: `main`

`main` / production must not be modified, merged, or deployed
without explicit owner approval.

`LUXEDGE_MASTER_PLAN.md` defines the mission and long-term direction.

`LUXEDGE_STATE.md` defines the current technical implementation,
migrations, commits, blockers, and next task.

Every coding/AI agent must read BOTH before working.

If a proposed task conflicts with this Master Plan,
report the conflict instead of silently changing direction.

---

# 1. BUSINESS NORTH STAR

Luxedge is NOT an AI demo.

Luxedge is being built as an autonomous premium USA pet-commerce business.

Primary goal:

MARKET INTELLIGENCE
→ WINNING PRODUCTS
→ SALES
→ PROFIT
→ REPEATABLE AUTOMATION
→ MINIMUM OWNER INTERACTION

Technology and AI features only matter if they improve:

- profitable sales
- sustainable margins
- customer experience
- reliable USA delivery
- low return/risk
- operational efficiency
- owner freedom

---

# 2. OWNER ROLE

The owner should progressively handle only:

- vision
- strategy
- budgets
- major approvals
- supplier/payment commitments
- high-risk exceptions
- important business decisions
- emergency/manual override

The owner should NOT need to manually perform routine:

- product research
- copying products
- writing listings
- market comparison
- repetitive supplier checks
- routine margin calculations
- ordinary listing QA
- repetitive browser operations

The long-term objective is for the owner to be able to leave routine
Luxedge operations running safely under automation.

---

# 3. AUTONOMOUS COMMERCE LOOP

Final operating loop:

USA MARKET INTELLIGENCE
        ↓
PRODUCT OPPORTUNITY DISCOVERY
        ↓
SUPPLIER RESEARCH
        ↓
SOURCE / STOCK / SHIPPING VERIFICATION
        ↓
LANDED COST + MARGIN
        ↓
PRODUCT SCORE
        ↓
MARKET OPPORTUNITY SCORE
        ↓
QA / RISK FILTER
        ↓
LISTING GENERATION
        ↓
CREATIVE GENERATION
        ↓
AUTONOMY POLICY
        ↓
PUBLISH
        ↓
STOCK / PRICE MONITORING
        ↓
SALES / PROFIT ANALYSIS
        ↓
WINNER / LOSER DETECTION
        ↓
OPTIMIZE / PAUSE / REPLACE
        ↓
REPEAT

Advertising automation comes later.

---

# 4. PRODUCT FUNNEL

Preferred funnel:

Discover 30–50
→ filter weak candidates
→ deep-review strongest candidates
→ select only evidence-supported winners
→ listing
→ creatives
→ QA
→ publish according to policy
→ monitor results

Never fill a quota with weak products.

If zero products meet requirements:
report ZERO.

Do not inflate scores.

---

# 5. PRODUCT SCORE /100

Default scoring model:

Demand / usefulness        20
Supplier reliability       15
USA delivery               15
Profit margin              15
Ratings/review evidence    10
Visual/viral potential     10
Competition                 5
Upsell potential            5
Return/complaint risk       5

TOTAL                      100

Default shortlist threshold:
75/100

Hard rejection rules always override AI enthusiasm.

---

# 6. MARKET INTELLIGENCE

The owner should NOT need to know what is currently selling in the USA.

Luxedge AI should eventually:

collect current market evidence
→ identify needs/trends/opportunities
→ create search hypotheses
→ discover products
→ verify sources
→ compare competitors/pricing
→ calculate product opportunity
→ feed the normal Product Scout pipeline

AI must reason over REAL collected evidence.

AI must never invent current-market facts.

Market evidence may include legitimately accessible:

- search patterns
- bestseller/trending pages
- repeated product concepts
- manufacturer pages
- retailer pages
- price bands
- rating/review evidence
- supplier availability
- delivery availability
- competition density
- public social/viral signals

---

# 7. EVIDENCE RULE

Every important fact must be:

VERIFIED
INFERRED
UNKNOWN

Never fabricate:

- supplier price
- landed cost
- shipping cost
- delivery time
- stock
- USA warehouse
- reviews
- ratings
- sales numbers
- materials
- dimensions
- certifications
- warranty
- medical/veterinary claims

UNKNOWN must remain UNKNOWN.

---

# 8. FLEXIBLE HUMAN / AI CONTROL

Luxedge must function with AI ON or OFF.

MASTER:

AI SERVICES
ON / OFF

When OFF:

- zero AI provider calls
- no hidden AI usage
- normal admin/storefront works
- deterministic Product Scout continues
- owner can work manually

CONTROL MODES:

MANUAL
ASSISTED
AUTONOMOUS

MANUAL:
owner controls actions.

ASSISTED:
AI researches, analyzes, recommends, drafts and QAs,
but important transitions remain owner-controlled.

AUTONOMOUS:
safe routine low-risk actions may advance automatically
when policy gates pass.

Owner can switch modes at any time.

Required controls:

TAKE MANUAL CONTROL
RESUME AI CONTROL
EMERGENCY PAUSE

---

# 9. AI PROVIDERS

Architecture must remain provider-agnostic.

Supported/planned:

- DeepSeek
- Claude / Anthropic
- OpenAI / Codex-capable models
- additional compatible providers later

Each provider should support:

ON/OFF
configured status
health
model
task permissions
priority
fallback
call limits
cost controls

No AI provider must become a permanent hard dependency.

If all AI providers are disabled,
Luxedge must still function manually/deterministically.

---

# 10. PROVIDER ROLES

Recommended starting philosophy:

DeepSeek:
bulk low-cost market intelligence,
research, structured analysis.

Claude:
optional premium reasoning,
listing/QA/second opinion.

OpenAI / Codex:
optional QA,
second opinion,
engineering/maintenance where appropriate.

Claude Code / Codex / Freebuff:
development/build/maintenance agents,
not mandatory permanent runtime dependencies.

Higgsfield:
creative engine for product/lifestyle/ad images/videos.

Browser automation:
hands for legitimate supplier/admin operations
where direct APIs are unavailable.

Hermes:
optional future 24/7 scheduler/worker,
not required for core Luxedge operation.

---

# 11. AI COST CONTROL

Always prefer:

1. deterministic logic
2. cheapest capable AI
3. stronger AI for uncertain/high-value decisions
4. second opinion only when justified

Admin cost strategies:

ECONOMY
BALANCED
QUALITY

Second opinion:

OFF
IMPORTANT ONLY
ALWAYS

Material provider disagreement should enter Owner Attention,
not silently become a random AI vote.

---

# 12. OWNER ATTENTION QUEUE

The owner should NOT receive constant routine approvals.

Only important exceptions should require attention:

- unusually strong but risky product
- supplier uncertainty
- IP/regulatory concern
- pricing exception
- important missing evidence
- paid supplier order
- supplier payment
- advertising budget
- failed critical automation
- security/business-critical change

Each attention item should explain:

WHY
EVIDENCE
RECOMMENDED ACTION
RISK

---

# 13. HARD CIRCUIT BREAKERS

AI must NEVER independently:

- rotate/change/delete credentials
- weaken security/RLS
- promote itself/users to admin
- alter its own safety limits without owner approval
- bypass hard product rejection
- disable emergency pause
- make supplier payments
- place paid supplier orders
- spend uncontrolled advertising money

Future advertising automation must have hard software limits:

daily spend ceiling
campaign ceiling
product-test ceiling
single-action ceiling
emergency pause

---

# 14. STOREFRONT / BRAND

Luxedge remains:

PREMIUM PET PRODUCTS

Preserve the current premium BLUE Luxedge identity
unless the owner explicitly changes branding.

Avoid unrelated generic-trending product drift.

No fake:

reviews
testimonials
sold counts
certifications
ratings
scarcity
marketing claims

Mobile and desktop must both be verified.

Checkout/payment must not be presented as live
until a real payment processor exists.

---

# 15. SECURITY

AI/provider secrets must remain server-side only.

Never commit:

API keys
service-role keys
JWT secrets
passwords

Never expose them in:

browser bundle
logs
state files
Master Plan
prompts stored in DB

`.env` remains gitignored.

---

# 16. CURRENT COMPLETED FOUNDATION

Completed direction includes:

Phase 1:
security/backend foundation

Phase 2:
truthful premium storefront / UX / SEO

Phase 3A:
live Supabase auth / API protection

Phase 3B:
live database / RLS / real product E2E

Phase 4A:
Product Scout
query discovery
manual URLs
research
scoring
hard rejection
QA
supplier dedupe
job logs

Phase 4B architecture:
AI Market Intelligence foundation
flexible AI controls
Manual / Assisted / Autonomous
provider routing
provider ON/OFF
AI master switch
cost strategies
second opinion
emergency pause

---

# 17. CURRENT IMMEDIATE OBJECTIVE

The immediate unfinished objective is:

REAL AI-GROUNDED MARKET INTELLIGENCE PROOF

Required:

real USA pet-market evidence
→ server-side AI provider
→ grounded Market Intelligence analysis
→ product-search hypotheses
→ Product Scout
→ Product Score
→ Market Opportunity Score
→ QA
→ strongest candidate

No automatic production publishing during proof.

Draft only.

Do not artificially select a candidate if none is strong enough.

---

# 18. FUTURE PHASES

After reliable AI Market Intelligence:

Listing Agent
→ factual listing QA
→ Higgsfield Creative Agent
→ Publish Agent
→ desktop/mobile QA
→ inventory/price monitoring
→ sales/profit analytics
→ winner/loser optimization
→ controlled autonomous publishing

ADS AGENT LAST.

Do not automate paid advertising before product/listing/monitoring
loops are reliable.

---

# 19. ANTI-DRIFT TEST

Before declaring future work PASS, ask:

1. Does it improve the path to profitable USA pet sales?
2. Does it reduce routine owner workload?
3. Is evidence real and traceable?
4. Does manual mode still work?
5. Can owner immediately take control?
6. Are providers configurable?
7. Are financial/security gates intact?
8. Are fake metrics/claims prevented?
9. Is main still protected?
10. Are we proving workflows before scaling?
11. Are sales/profit more important than AI feature count?
12. Are we moving toward safe unattended operations?

If major answers are NO:
do not declare the phase complete.

---

# 20. PERMANENT RULE

LUXEDGE_MASTER_PLAN.md
= WHY + WHERE WE ARE GOING

LUXEDGE_STATE.md
= WHAT EXISTS RIGHT NOW

Implementation details may evolve.

The business mission must not silently drift.
