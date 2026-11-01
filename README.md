# IMM Pediatrics: landing and access site

A static, storytelling landing page plus a sign-in/payment page that is ready to plug into a backend. There are **no
download links** anywhere: members get their install link by email after the server confirms payment.

```
site/
  index.html          the story page (hero, sticky phone, numbers, how it is built, early-access form)
  access.html         sign in by emailed code, see account, start payment, request the install link
  legal.html          privacy/terms TEMPLATE (highlighted items are yours to complete; lawyer review before charging)
  config.js           the only file to edit to connect a backend (mode, apiBase, plan, price label)
  assets/             site.css, site.js (IMM.api door, demo backend, scroll behaviour), shots/*.webp (app screens)
  api/openapi.yaml    the contract a backend implements
  server/             mock-server.mjs (a working stand-in) and mock.test.mjs
```

## See it now (no backend)

Open `index.html` through any static server (`python -m http.server` in this folder). `config.js` ships in **demo
mode**: forms succeed against fake data kept in the browser. On `access.html` any email works and the code is `123456`.

## Try the real wiring locally

```
node site/server/mock-server.mjs         # serves the site and the API on http://localhost:8787
```
In `config.js` set `mode: "live"` and leave `apiBase: ""` (same origin). The mock prints sign-in codes to its console,
and you can grant yourself access with a signed webhook:

```
body='{"type":"payment.succeeded","email":"you@x.org","plan":"founding"}'
sig=$(printf '%s' "$body" | openssl dgst -sha256 -hmac dev-secret | awk '{print $2}')
curl -X POST localhost:8787/v1/webhooks/payment -H "x-signature: $sig" -H 'Content-Type: application/json' -d "$body"
```
Tests: `node --test site/server/mock.test.mjs`.

## Going live: what the backend must do

Implement `api/openapi.yaml`. The parts that matter:

1. **Waitlist** (`POST /v1/waitlist`): store email, role, exam date and the consent flag; rate limit; optional bot check.
2. **Email sign-in** (`/v1/auth/request-link`, `/verify`, `/logout`): 6-digit code, 10-minute expiry, 5 tries, always answer 200
   to a request (no account enumeration). Session is an `HttpOnly; Secure; SameSite=Lax` cookie.
3. **Entitlements are decided only by payment webhooks** (`POST /v1/webhooks/payment`): verify the provider's signature on the
   raw body, make it idempotent by event id, grant on success, remove on refund.
4. **Checkout** (`POST /v1/checkout`): create a hosted-checkout session with your provider and return its URL; take the price from your
   own plan table, never from the browser.
5. **Install link** (`POST /v1/access/install-link`): only with an active entitlement; email a signed, single-use, short-lived link.
   Never return a file URL to the browser, and keep the build files out of any public folder.

CORS: if the site and API are on different origins, allow the site origin with credentials and send the cookie with
`SameSite=None; Secure` (or put both behind one domain, which is simpler). In `config.js` set `mode: "live"` and `apiBase`.

### Payments

Stripe is not generally available to businesses registered in Pakistan; check current availability for your situation.
Realistic options to evaluate: a merchant-of-record such as Paddle or Lemon Squeezy (they handle tax and invoicing, and
pay out to you), or a local gateway/wallet (for example Safepay, PayFast, JazzCash, Easypaisa). Whichever you pick, the page code
does not change: it only calls `/v1/checkout` and trusts `/v1/me`.

### Hosting

The pages are static: Cloudflare Pages, Netlify, Vercel or GitHub Pages all work. Put the API on the same domain
(`/v1/*`) to keep cookies simple. Add a Content-Security-Policy that allows your API origin and the Google Fonts stylesheet.

## Before you charge anyone

- **Content rights.** The text draws on textbooks (Nelson and others) and the figures include images from atlases you own.
  Selling access to that material is a licensing question, not only a technical one. Take advice, and consider the
  distribution build (`IMM_DISTRIBUTE=1`) that leaves out the owner-supplied atlas images. The page already says readers
  bring their own copy of a textbook to open its pages; keep that true.
- **Claims.** The page says answer keys can be Draft and that doses are under clinical review. Keep it that way until a
  clinician has signed the review items off; do not add testimonials, outcomes or "pass rate" claims you cannot prove.
- **Legal pages.** Complete `legal.html` (business name, address, refund terms, data processing) and have it reviewed.
- **Privacy.** You are collecting emails: keep a record of consent, honour deletion requests, and avoid third-party analytics
  until you have decided on them (none is loaded by default).
