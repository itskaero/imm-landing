/**
 * A stand-in backend for local development. It implements api/openapi.yaml with in-memory data and no dependencies,
 * so the site (config.js: mode "live", apiBase "http://localhost:8787") can be exercised end to end before the real
 * backend exists. It is NOT for production: no persistence, no real email, codes printed to the console.
 *
 *   node site/server/mock-server.mjs            (serves the site and the API on :8787)
 *   WEBHOOK_SECRET=... PORT=8787 node site/server/mock-server.mjs
 */
import http from "node:http";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".webp": "image/webp", ".svg": "image/svg+xml", ".yaml": "text/yaml", ".json": "application/json" };
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function createApp({ webhookSecret = process.env.WEBHOOK_SECRET || "dev-secret", exposeCodes = true, allowedOrigin = process.env.ALLOWED_ORIGIN || "", now = () => Date.now(), log = console.log } = {}) {
  const state = { waitlist: [], codes: new Map(), sessions: new Map(), entitlements: new Map(), checkouts: new Map(), hits: new Map() };

  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers });
    res.end(JSON.stringify(body));
  };
  const problem = (res, status, code, message) => send(res, status, { error: { code, message } });
  const readBody = (req) => new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on("data", (c) => { size += c.length; if (size > 1e5) { reject(Object.assign(new Error("too large"), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
  const session = (req) => {
    const m = /(?:^|;\s*)imm_session=([a-f0-9]+)/.exec(req.headers.cookie || "");
    const s = m && state.sessions.get(m[1]);
    return s && s.expires > now() ? s : null;
  };
  const limited = (key, max, windowMs) => {
    const t = now(); const hits = (state.hits.get(key) || []).filter((x) => t - x < windowMs);
    hits.push(t); state.hits.set(key, hits);
    return hits.length > max;
  };

  async function api(req, res, url) {
    const raw = req.method === "POST" ? await readBody(req) : Buffer.alloc(0);
    let body = {};
    if (raw.length) { try { body = JSON.parse(raw.toString("utf8")); } catch { return problem(res, 400, "bad_json", "The request body is not valid JSON."); } }
    const email = String(body.email || "").trim().toLowerCase();
    const route = `${req.method} ${url.pathname}`;

    if (route === "POST /v1/waitlist") {
      if (!EMAIL.test(email)) return problem(res, 422, "invalid_email", "Please enter a valid email address.");
      if (body.consent !== true) return problem(res, 422, "consent_required", "Consent to be emailed is required.");
      if (!state.waitlist.some((w) => w.email === email)) state.waitlist.push({ email, role: body.role, examDate: body.examDate, source: body.source, at: now() });
      return send(res, 201, { ok: true, position: state.waitlist.findIndex((w) => w.email === email) + 1 });
    }
    if (route === "POST /v1/auth/request-link") {
      if (!EMAIL.test(email)) return problem(res, 422, "invalid_email", "Please enter a valid email address.");
      if (limited(`code:${email}`, 5, 3600e3)) return problem(res, 429, "rate_limited", "Too many requests. Try again later.");
      const code = String(crypto.randomInt(0, 1e6)).padStart(6, "0");
      state.codes.set(email, { code, expires: now() + 600e3, tries: 0 });
      log(`[mock] sign-in code for ${email}: ${code}`);
      return send(res, 200, exposeCodes ? { ok: true, demoCode: code } : { ok: true });   // a real server never returns the code
    }
    if (route === "POST /v1/auth/verify") {
      const c = state.codes.get(email);
      if (!c || c.expires < now() || c.tries >= 5) return problem(res, 401, "bad_code", "That code has expired. Ask for a new one.");
      c.tries += 1;
      if (c.code !== String(body.code || "").trim()) return problem(res, 401, "bad_code", "That code is not right. Try again.");
      state.codes.delete(email);
      const id = crypto.randomBytes(24).toString("hex");
      state.sessions.set(id, { email, expires: now() + 30 * 864e5 });
      return send(res, 200, { ok: true }, { "Set-Cookie": `imm_session=${id}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${30 * 86400}` });
    }
    if (route === "POST /v1/auth/logout") {
      const m = /imm_session=([a-f0-9]+)/.exec(req.headers.cookie || ""); if (m) state.sessions.delete(m[1]);
      return send(res, 200, { ok: true }, { "Set-Cookie": "imm_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0" });
    }
    if (route === "GET /v1/me") {
      const s = session(req); if (!s) return problem(res, 401, "signed_out", "Not signed in.");
      return send(res, 200, { email: s.email, entitlement: state.entitlements.get(s.email) || { active: false } });
    }
    if (route === "POST /v1/checkout") {
      const s = session(req); if (!s) return problem(res, 401, "signed_out", "Sign in first.");
      const id = `cs_${crypto.randomBytes(8).toString("hex")}`;
      state.checkouts.set(id, { email: s.email, plan: body.plan });
      return send(res, 200, { url: `${body.successUrl || "/access.html?paid=1"}&session=${id}` });   // a real server returns the provider's hosted page
    }
    if (route === "POST /v1/webhooks/payment") {
      const want = crypto.createHmac("sha256", webhookSecret).update(raw).digest("hex");
      const got = String(req.headers["x-signature"] || "");
      const ok = got.length === want.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
      if (!ok) return problem(res, 401, "bad_signature", "Signature check failed.");
      if (body.type === "payment.succeeded" && EMAIL.test(email)) state.entitlements.set(email, { active: true, plan: body.plan, expiresAt: body.expiresAt || null });
      if (body.type === "payment.refunded" && EMAIL.test(email)) state.entitlements.set(email, { active: false, plan: body.plan, expiresAt: null });
      return send(res, 200, { ok: true });
    }
    if (route === "POST /v1/access/install-link") {
      const s = session(req); if (!s) return problem(res, 401, "signed_out", "Sign in first.");
      const e = state.entitlements.get(s.email);
      if (!e || !e.active) return problem(res, 403, "no_entitlement", "Your account does not have access yet.");
      log(`[mock] would email a one-time install link to ${s.email}`);
      return send(res, 200, { ok: true, delivery: "email" });
    }
    return problem(res, 404, "not_found", "Unknown route.");
  }

  async function files(req, res, url) {
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith("/")) rel += "index.html";
    const file = path.resolve(SITE, "." + rel);
    if (!file.startsWith(SITE + path.sep) || rel.includes("/server/")) { res.writeHead(403); return res.end("Forbidden"); }
    try { const data = await readFile(file); res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" }); res.end(data); }
    catch { res.writeHead(404); res.end("Not found"); }
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (allowedOrigin) {
      res.setHeader("Access-Control-Allow-Origin", allowedOrigin); res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type"); res.setHeader("Vary", "Origin");
      if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
    }
    try { return url.pathname.startsWith("/v1/") ? await api(req, res, url) : await files(req, res, url); }
    catch (err) { return problem(res, err.status || 500, "server_error", err.status === 413 ? "Request too large." : "Something went wrong."); }
  });
  return { server, state };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 8787);
  createApp().server.listen(port, () => console.log(`Mock backend and site on http://localhost:${port}  (set mode "live", apiBase "" in config.js)`));
}
