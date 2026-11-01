/**
 * Site configuration: the only file you edit to connect a backend.
 *
 *   mode "demo"  no network: forms succeed against fake data kept in this browser, so the whole flow can be seen
 *   mode "live"  every form talks to `apiBase` (see api/openapi.yaml for the contract)
 *
 * Nothing here is secret: it ships to the browser. Keep keys (payment, email, database) on the server.
 */
window.IMM_SITE = {
  mode: "demo",                       // "demo" | "live"
  apiBase: "",                        // e.g. "https://api.your-domain.com"  (same origin: leave "" and mode "live")
  product: "IMM Pediatrics",
  plan: {
    id: "founding",
    name: "Founding access",
    priceLabel: "Pricing announced soon",   // shown on the page; set to e.g. "PKR 9,900 / year" when decided
    blurb: "Everything in the app for the length of your exam preparation, plus every update.",
    checkout: "none",                 // "none" | "redirect": the server returns a hosted-checkout URL (any provider)
  },
  waitlist: { collectExamDate: true, roles: ["Postgraduate trainee", "Consultant / tutor", "Other"] },
  botCheck: { provider: "none", siteKey: "" },   // "turnstile" | "recaptcha" | "none": add the provider's script and key
  analytics: { provider: "none", id: "" },       // wire your own; nothing is loaded by default
  support: "hello@example.com",                  // replace
};
