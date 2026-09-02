# LUXEDGE — Easy Listing Guide (Product lagane ke 3 tarike)

> Simple version. `salman` ke liye: aapko kisi bhi waqt product storefront par
> LIVE karna ho to yeh 3 raaste hain. Teenon se result same hai — ek product
> row jo `/product/<slug>` par dikhta hai aur `/shop` par bikta hai.

## Tareeka 1 — Scout (AUTO, sabse aasaan) — recommended

Research → approve → rocket → **LIVE**. Har cheez evidence-based, galti wali
listing nahi banti.

1. **Admin → Product Scout** → "Run Scout Run" → URL paste karein (ya
   "Autonomous Discovery" query dein) → **Run Research**.
2. Research, scoring, QA khud chalta hai. Ek **approved** candidate mile.
3. Candidate row par **🚀 (Rocket)** dabayein.
   - Exact CJ price hai → seedha LIVE.
   - Price nahi hai → chhota modal aata hai: suggested price (evidence se)
     dikha kar aap confirm karte hain → **Publish LIVE**.
4. Done. Badge **"LIVE ON STORE"** → storefront par product aa gaya.

`Publish Approved` button = saare approved candidates ek saath LIVE.

## Tareeka 2 — Add Product form (MANUAL)

1. **Admin → Catalog → Products → "Add Product"**.
2. Form bharein (name, price, images…), status **Live** chunein → Save.
3. Product turant storefront par.

## Tareeka 3 — API (koi bhi tool/script se)

Ek endpoint hai: **`POST /api/admin/products`** — admin JWT ke saath. Ek JSON,
ek call, product LIVE.

**Request (curl):**

```bash
curl -X POST https://luxedge.us/api/admin/products \
  -H "Authorization: Bearer <YOUR_ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "KONG Classic Dog Toy",
    "price": 11.96,
    "status": "live",
    "image_urls": ["https://cdn.example.com/kong-classic-1.jpg", "https://cdn.example.com/kong-classic-2.jpg"],
    "description": "Durable natural rubber dog toy",
    "brand": "KONG"
  }'
```

**Response (201):**

```json
{ "ok": true, "id": "a1b2…", "slug": "kong-classic-dog-toy", "url": "/product/kong-classic-dog-toy", "status": "active" }
```

**Fields:**

| Field | Zaroori? | Note |
|---|---|---|
| `title` | ✓ | 3–200 chars — slug isi se banta hai |
| `price` | ✓ | USD, 0 se bada |
| `status` | ✗ | `live` (default) ya `draft` |
| `image_urls` | ✗ | http(s) URLs, max 8 |
| `description` / `brand` | ✗ | optional |

**Admin token kahan se?** Admin panel me jab aap logged hote ho to browser
Session Storage me `*access_token*` entry hoti hai (Supabase JWT — role admin).
Yahi token `Authorization: Bearer` me daalein. Ya kisi bhi Supabase admin
session se.

**Aam errors:**

| Code | Matlab | Fix |
|---|---|---|
| 401/403 | Token missing/invalid/non-admin | Sahi admin token lagayein |
| 400 | Field ghalat (title/price/status/image) | Error message batata hai kaunsa field |
| 405 | GET/PUT diya | `POST` use karein |
| 500/503 | Server/DB masla ya env configure nahi | `wrangler` secrets check karein, dobara try |

**Draft vs Live:** `"status": "draft"` bhejein to product save hota hai par
storefront par nahi dikhta — pehle check karne ke liye perfect. Baad me
Catalog admin me **Live** toggle dabane par LIVE ho jata hai.

---

**Rule of thumb:** Tareeka 1 sabse aasaan (AI evidence ke saath), Tareeka 3
sabse direct (script/automation ke liye). Ek product mann bhar ka — teeno
Tareeke ka result wahi hai: **storefront par LIVE listing**.