/* Behaviour for the landing and access pages.
   - IMM.api(path, {method, body}) is the one door to a backend (live) or to a pretend one kept in this browser (demo).
   - Everything else is presentation: scroll reveal, the phone that follows the story, counters. */
(() => {
  const cfg = window.IMM_SITE || {};
  const live = cfg.mode === "live";
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  /* ---------- the pretend backend (demo mode): same routes and shapes as api/openapi.yaml ---------- */
  const store = {
    read() { try { return JSON.parse(localStorage.getItem("imm-demo") || "{}"); } catch { return {}; } },
    write(v) { try { localStorage.setItem("imm-demo", JSON.stringify(v)); } catch { /* private mode */ } },
  };
  const fail = (status, code, message) => Object.assign(new Error(message), { status, data: { error: { code, message } } });
  async function demoApi(path, { method = "GET", body } = {}) {
    await sleep(450);
    const db = store.read();
    const email = (body && body.email || "").trim().toLowerCase();
    if (method === "POST" && path === "/v1/waitlist") {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw fail(422, "invalid_email", "Please enter a valid email address.");
      db.waitlist = [...(db.waitlist || []).filter((w) => w.email !== email), { email, role: body.role, examDate: body.examDate, at: Date.now() }];
      store.write(db);
      return { ok: true, position: db.waitlist.length };
    }
    if (method === "POST" && path === "/v1/auth/request-link") {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw fail(422, "invalid_email", "Please enter a valid email address.");
      db.pending = { email, code: "123456" };
      store.write(db);
      return { ok: true, demoCode: "123456" };           // a real server never returns the code
    }
    if (method === "POST" && path === "/v1/auth/verify") {
      if (!db.pending || db.pending.email !== email || db.pending.code !== String(body.code || "").trim()) throw fail(401, "bad_code", "That code is not right. Try again.");
      db.session = { email, entitlement: (db.entitlements || {})[email] || { active: false } };
      delete db.pending;
      store.write(db);
      return { ok: true };
    }
    if (method === "GET" && path === "/v1/me") {
      if (!db.session) throw fail(401, "signed_out", "Not signed in.");
      return { email: db.session.email, entitlement: (db.entitlements || {})[db.session.email] || { active: false } };
    }
    if (method === "POST" && path === "/v1/checkout") {
      if (!db.session) throw fail(401, "signed_out", "Sign in first.");
      return { url: `${location.pathname}?demo-paid=1` };   // a real server returns the payment provider's hosted page
    }
    if (method === "POST" && path === "/v1/access/install-link") {
      if (!db.session) throw fail(401, "signed_out", "Sign in first.");
      const ent = (db.entitlements || {})[db.session.email];
      if (!ent || !ent.active) throw fail(403, "no_entitlement", "Your account does not have access yet.");
      return { ok: true, delivery: "email" };
    }
    if (method === "POST" && path === "/v1/auth/logout") { delete db.session; store.write(db); return { ok: true }; }
    if (method === "POST" && path === "/v1/demo/grant") {       // demo only: pretend a payment arrived
      if (!db.session) throw fail(401, "signed_out", "Sign in first.");
      db.entitlements = { ...(db.entitlements || {}), [db.session.email]: { active: true, plan: cfg.plan && cfg.plan.id, expiresAt: null } };
      store.write(db);
      return { ok: true };
    }
    throw fail(404, "not_found", "Unknown route.");
  }

  /* ---------- the real door ---------- */
  async function api(path, { method = "GET", body } = {}) {
    if (!live) return demoApi(path, { method, body });
    const res = await fetch((cfg.apiBase || "") + path, {
      method, credentials: "include",
      headers: body ? { "Content-Type": "application/json", Accept: "application/json" } : { Accept: "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error((data.error && data.error.message) || res.statusText), { status: res.status, data });
    return data;
  }
  window.IMM = { cfg, live, api, store };

  /* ---------- fill the page from config ---------- */
  const bind = { "plan.name": cfg.plan && cfg.plan.name, "plan.priceLabel": cfg.plan && cfg.plan.priceLabel, "plan.blurb": cfg.plan && cfg.plan.blurb, "product": cfg.product, "support": cfg.support };
  $$("[data-bind]").forEach((el) => { const v = bind[el.dataset.bind]; if (v) el.textContent = v; });
  $$("[data-support]").forEach((a) => { if (cfg.support) a.href = `mailto:${cfg.support}`; });
  $$(".demo-note").forEach((n) => { n.hidden = live; });
  const roles = $("select[name=role]");
  if (roles && cfg.waitlist) roles.innerHTML = cfg.waitlist.roles.map((r) => `<option>${r}</option>`).join("");
  const exam = $("[data-exam]");
  if (exam && cfg.waitlist && !cfg.waitlist.collectExamDate) exam.hidden = true;

  /* ---------- reveal on scroll ---------- */
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const seen = new IntersectionObserver((entries) => entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); seen.unobserve(e.target); } }), { threshold: .12 });
  $$(".rv").forEach((el) => (reduce ? el.classList.add("in") : seen.observe(el)));

  /* ---------- the phone follows the story ---------- */
  const sticky = $(".sticky");
  if (sticky) {
    const shots = $$(".screen .layer", sticky);
    const scenes = $$(".scene");
    const show = (i) => { shots.forEach((s, k) => s.classList.toggle("on", k === i)); sticky.dataset.step = String(i + 1); };
    show(0);
    const watch = new IntersectionObserver((entries) => entries.forEach((e) => {
      if (!e.isIntersecting) return;
      const i = scenes.indexOf(e.target);
      scenes.forEach((s) => s.classList.toggle("is-on", s === e.target));
      if (e.target.dataset.shot) show(Number(e.target.dataset.shot));
    }), { rootMargin: "-42% 0px -42% 0px" });
    scenes.forEach((s) => watch.observe(s));
  }

  /* ---------- counters ---------- */
  const count = (el) => {
    const to = Number(el.dataset.count), dur = 1400, t0 = performance.now();
    const step = (t) => { const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3); el.textContent = Math.round(to * e).toLocaleString("en-US"); if (p < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  };
  const counters = new IntersectionObserver((entries) => entries.forEach((e) => { if (e.isIntersecting) { reduce ? (e.target.textContent = Number(e.target.dataset.count).toLocaleString("en-US")) : count(e.target); counters.unobserve(e.target); } }), { threshold: .6 });
  $$("[data-count]").forEach((el) => counters.observe(el));

  /* ---------- the waitlist form ---------- */
  const waitlist = $("#waitlist");
  if (waitlist) {
    const msg = $(".msg", waitlist), btn = $("button[type=submit]", waitlist);
    waitlist.addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = new FormData(waitlist);
      if (!f.get("consent")) { msg.className = "msg err"; msg.textContent = "Please tick the box so we may email you about access."; return; }
      btn.disabled = true; msg.className = "msg"; msg.textContent = "Sending...";
      try {
        const r = await api("/v1/waitlist", { method: "POST", body: { email: f.get("email"), role: f.get("role"), examDate: f.get("examDate") || undefined, consent: true, source: location.pathname } });
        msg.className = "msg ok";
        msg.textContent = r.position ? `You are on the list (number ${r.position}). We will email you when access opens.` : "You are on the list. We will email you when access opens.";
        waitlist.reset();
      } catch (err) { msg.className = "msg err"; msg.textContent = err.message || "Something went wrong. Please try again."; }
      btn.disabled = false;
    });
  }
})();
