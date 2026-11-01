// node --test site/server/
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createApp } from "./mock-server.mjs";

async function boot(opts = {}) {
  const app = createApp({ log: () => {}, ...opts });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const call = async (method, path, body, cookie = "") => {
    const res = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json().catch(() => ({})), cookie: (res.headers.get("set-cookie") || "").split(";")[0] };
  };
  return { ...app, base, call, close: () => new Promise((r) => app.server.close(r)) };
}

test("the waitlist validates the email and the consent, and lists each person once", async () => {
  const s = await boot();
  assert.equal((await s.call("POST", "/v1/waitlist", { email: "nope", consent: true })).status, 422);
  assert.equal((await s.call("POST", "/v1/waitlist", { email: "a@b.co", consent: false })).body.error.code, "consent_required");
  const first = await s.call("POST", "/v1/waitlist", { email: "A@b.co", consent: true });
  const again = await s.call("POST", "/v1/waitlist", { email: "a@b.co", consent: true });
  assert.equal(first.status, 201);
  assert.equal(first.body.position, 1);
  assert.equal(again.body.position, 1);
  await s.close();
});

test("sign in by emailed code, then read the account; a wrong code and a signed-out call are refused", async () => {
  const s = await boot();
  assert.equal((await s.call("GET", "/v1/me")).status, 401);
  const { body } = await s.call("POST", "/v1/auth/request-link", { email: "dr@x.org" });
  assert.match(body.demoCode, /^\d{6}$/);
  assert.equal((await s.call("POST", "/v1/auth/verify", { email: "dr@x.org", code: "000000" })).status, 401);
  const ok = await s.call("POST", "/v1/auth/verify", { email: "dr@x.org", code: body.demoCode });
  assert.equal(ok.status, 200);
  assert.match(ok.cookie, /^imm_session=/);
  const me = await s.call("GET", "/v1/me", null, ok.cookie);
  assert.deepEqual(me.body, { email: "dr@x.org", entitlement: { active: false } });
  await s.close();
});

test("an expired code is refused", async () => {
  let t = 1_000_000;
  const s = await boot({ now: () => t });
  const { body } = await s.call("POST", "/v1/auth/request-link", { email: "dr@x.org" });
  t += 11 * 60e3;
  assert.equal((await s.call("POST", "/v1/auth/verify", { email: "dr@x.org", code: body.demoCode })).status, 401);
  await s.close();
});

test("access is gated by a payment: the install link is refused until a correctly signed webhook arrives", async () => {
  const s = await boot({ webhookSecret: "shh" });
  const { body } = await s.call("POST", "/v1/auth/request-link", { email: "dr@x.org" });
  const { cookie } = await s.call("POST", "/v1/auth/verify", { email: "dr@x.org", code: body.demoCode });
  assert.equal((await s.call("POST", "/v1/access/install-link", {}, cookie)).body.error.code, "no_entitlement");

  const event = JSON.stringify({ type: "payment.succeeded", email: "dr@x.org", plan: "founding" });
  const post = (signature) => fetch(s.base + "/v1/webhooks/payment", { method: "POST", headers: { "Content-Type": "application/json", "x-signature": signature }, body: event });
  assert.equal((await post("0".repeat(64))).status, 401);
  const good = crypto.createHmac("sha256", "shh").update(event).digest("hex");
  assert.equal((await post(good)).status, 200);

  assert.equal((await s.call("GET", "/v1/me", null, cookie)).body.entitlement.active, true);
  const link = await s.call("POST", "/v1/access/install-link", {}, cookie);
  assert.deepEqual(link.body, { ok: true, delivery: "email" });
  await s.close();
});

test("a refund takes access away again", async () => {
  const s = await boot({ webhookSecret: "shh" });
  const send = (type) => { const e = JSON.stringify({ type, email: "dr@x.org", plan: "founding" }); return fetch(s.base + "/v1/webhooks/payment", { method: "POST", headers: { "Content-Type": "application/json", "x-signature": crypto.createHmac("sha256", "shh").update(e).digest("hex") }, body: e }); };
  await send("payment.succeeded");
  assert.equal(s.state.entitlements.get("dr@x.org").active, true);
  await send("payment.refunded");
  assert.equal(s.state.entitlements.get("dr@x.org").active, false);
  await s.close();
});

test("the server never exposes its own code and does not leak files outside the site", async () => {
  const s = await boot();
  assert.equal((await fetch(s.base + "/server/mock-server.mjs")).status, 403);
  assert.equal((await fetch(s.base + "/..%2f..%2fpackage.json")).status, 403);
  assert.equal((await fetch(s.base + "/index.html")).status, 200);
  await s.close();
});

test("code requests are rate limited", async () => {
  const s = await boot();
  let last;
  for (let i = 0; i < 6; i++) last = await s.call("POST", "/v1/auth/request-link", { email: "dr@x.org" });
  assert.equal(last.status, 429);
  await s.close();
});
