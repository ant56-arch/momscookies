(() => {
  'use strict';

  /* ---------- config & helpers ---------- */
  const CFG = { owner: 'ant56-arch', repo: 'momscookies', branch: 'main', path: 'data/portal.enc.json' };
  // Where the encrypted data lives. "public" = inside this website's repository (anyone can download the
  // scrambled file). "private" = a separate private repository named in data/site.json ("dataRepo").
  const STORES = { public: { repo: 'momscookies', vault: 'data/portal.enc.json', photos: 'data/photos', branch: 'main' }, private: null };
  let DATA = STORES.public;
  const repoApi = (st) => `https://api.github.com/repos/${CFG.owner}/${st.repo}/contents/`;
  const refQ = (st) => (st.branch ? `ref=${st.branch}&` : '');
  const STATUSES = ['Requested', 'Confirmed', 'Baking', 'Ready', 'Completed', 'Declined'];
  const OPEN = ['Requested', 'Confirmed', 'Baking', 'Ready'];
  const REF_SKIP = ['Enter Cookie Orders', 'Complete Orders', 'Cookie Order Data'];

  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v) => (Number.isFinite(+v) ? +v : 0);
  const money = (v) => '$' + num(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pad = (n) => String(n).padStart(2, '0');
  const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const todayISO = () => isoDate(new Date());
  const fmtDate = (s) => {
    if (!s) return '';
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  };

  // ---------- wording helpers ----------
  const plural = (n, one, many) => `${Number(n).toLocaleString()} ${Number(n) === 1 ? one : many || one + 's'}`;
  const cookiesOf = (q) => (q == null || q === '' ? '? cookies' : plural(+q, 'cookie'));
  const pageHead = (title, sub, actions = '') => `<div class="page-head"><div><h2>${title}</h2>${sub ? `<p class="sub">${sub}</p>` : ''}</div>${actions ? `<div class="ph-actions">${actions}</div>` : ''}</div>`;
  const relDue = (d, today) => {
    if (!d) return '';
    const diff = Math.round((new Date(d + 'T00:00') - new Date(today + 'T00:00')) / 864e5);
    return diff === 0 ? ' · today' : diff === 1 ? ' · tomorrow' : diff > 1 && diff <= 14 ? ` · in ${diff} days` : diff < 0 ? ` · ${plural(-diff, 'day')} ago` : '';
  };
  const SMALL_WORDS = new Set(['a', 'an', 'and', 'at', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'vs', 'with']);
  const tidySpace = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
  const upFirst = (v) => v.charAt(0).toUpperCase() + v.slice(1);
  const titleCase = (v) => v.toLowerCase().split(' ').map((w, i) => (i > 0 && SMALL_WORDS.has(w) ? w
    : w.replace(/(^|[/(\-])([a-z])/g, (m, a, b) => a + b.toUpperCase()))).join(' ');
  const allLower = (v) => /[a-z]/.test(v) && v === v.toLowerCase();
  const fixName = (v) => { v = tidySpace(v); return allLower(v) ? titleCase(v) : upFirst(v); };
  const fixEvent = (v) => { v = tidySpace(v).replace(/[,;]+$/, ''); return allLower(v) ? titleCase(v) : upFirst(v); };
  const fixSentence = (v) => upFirst(tidySpace(v).replace(/\s+([,.;:!?])/g, '$1').replace(/[,;]+$/, ''));
  const fixReason = (v) => fixSentence(v).replace(/^Didnt\b/i, "Didn't");
  const fixPhone = (v) => {
    v = tidySpace(v); const d = v.replace(/\D/g, '');
    const t = d.length === 11 && d[0] === '1' ? d.slice(1) : d;
    return t.length === 10 && !/[a-z]/i.test(v) ? `(${t.slice(0, 3)}) ${t.slice(3, 6)}-${t.slice(6)}` : v;
  };
  const fixEmail = (v) => tidySpace(v).toLowerCase();
  const telHref = (v) => 'tel:' + String(v).replace(/[^\d+]/g, '');
  const smsHref = (v) => 'sms:' + String(v).replace(/[^\d+]/g, '');
  // Older orders kept everything in one "contact" box: split it into phone / email / social.
  function splitContact(o) {
    const c = (o.contact || '').trim();
    if (!c || o.phone || o.email || o.social) return o;
    if (/@\S+\.\S+/.test(c)) o.email = c.match(/\S+@\S+\.\S+/)[0];
    else if (c.replace(/\D/g, '').length >= 7) o.phone = c;
    else o.social = c;
    o.contact = '';
    return o;
  }
  const TEXT_FIELDS = { phone: fixPhone, email: fixEmail, social: tidySpace, name: fixName, event: fixEvent, colors: fixSentence, allergies: fixSentence, addOns: fixSentence, notes: fixSentence, reason: fixReason, contact: tidySpace };
  const TEXT_LABELS = { name: 'Name', event: 'Event', colors: 'Colors', allergies: 'Allergies', addOns: 'Add-ons', notes: 'Notes', reason: 'Reason', contact: 'Contact', phone: 'Phone', email: 'Email', social: 'Facebook or Instagram' };
  function tidyOrder(o) { for (const [f, fn] of Object.entries(TEXT_FIELDS)) if (typeof o[f] === 'string' && o[f]) o[f] = fn(o[f]); return o; }
  function tidyChanges() {
    const out = [];
    for (const o of S.vault.orders) for (const [f, fn] of Object.entries(TEXT_FIELDS)) {
      const v = o[f];
      if (typeof v !== 'string' || !v) continue;
      const to = fn(v);
      if (to !== v) out.push({ o, f, from: v, to });
    }
    return out;
  }
  // ---------- theme (Auto / Light / Dark) ----------
  const themePref = () => { try { return localStorage.getItem('gcj_theme') || 'auto'; } catch { return 'auto'; } };
  const darkMq = window.matchMedia('(prefers-color-scheme: dark)');
  function applyTheme() {
    const p = themePref(), t = p === 'auto' ? (darkMq.matches ? 'dark' : 'light') : p;
    document.documentElement.dataset.theme = t;
    const m = document.querySelector('meta[name="theme-color"]'); if (m) m.content = t === 'dark' ? '#171210' : '#faf6f0';
  }
  darkMq.addEventListener('change', applyTheme);
  applyTheme();

  // ---------- toasts (small messages, optional Undo) ----------
  function toast(msg, { action, onAction, kind = '', ms = 5000 } = {}) {
    let box = $('#toasts');
    if (!box) {
      box = document.createElement('div'); box.id = 'toasts'; box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite');
      if ('popover' in box) box.popover = 'manual';
      document.body.appendChild(box);
    }
    if (box.showPopover) { try { box.hidePopover(); } catch { /* not open */ } try { box.showPopover(); } catch { /* ignore */ } } // re-open so it sits above any dialog
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button type="button">${esc(action)}</button>` : ''}`;
    const close = () => { el.classList.add('out'); setTimeout(() => el.remove(), 220); };
    if (action) el.querySelector('button').onclick = () => { if (onAction) onAction(); close(); };
    box.appendChild(el);
    setTimeout(close, action ? 8000 : ms);
  }
  const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const withTransition = (fn) => (document.startViewTransition && !reducedMotion() ? document.startViewTransition(fn) : fn());

  const ico = (n) => `<svg class="ic" aria-hidden="true"><use href="#i-${n}"/></svg>`;
  const b64e = (u8) => { let s = ''; u8.forEach((b) => (s += String.fromCharCode(b))); return btoa(s); };
  const b64d = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

  const S = {
    key: null, salt: null, iter: 600000, sha: null, vault: null, site: null,
    oview: (() => { try { return localStorage.getItem('gcj_oview') || 'list'; } catch { return 'list'; } })(), pKind: 'all', pOcc: '', pYear: 'All', pq: '', tab: 'home', filter: 'Orders', oyear: 'All', sort: 'newest', q: '', year: null, refSheet: null, dirty: false,
  };

  /* ---------- crypto ---------- */
  async function derive(user, pw, salt, iter) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(`${user}:${pw}`), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function seal() {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, S.key, new TextEncoder().encode(JSON.stringify(S.vault)));
    return JSON.stringify({ v: 1, iter: S.iter, salt: b64e(S.salt), iv: b64e(iv), data: b64e(new Uint8Array(ct)) });
  }
  async function open(env, user, pw) {
    const salt = b64d(env.salt);
    const key = await derive(user, pw, salt, env.iter);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(env.iv) }, key, b64d(env.data));
    S.key = key; S.salt = salt; S.iter = env.iter;
    S.vault = JSON.parse(new TextDecoder().decode(plain));
    S.loaded = JSON.stringify(env);
  }

  // Phone keyboards often capitalize the first letter or add a trailing space, so try the
  // likely variants. Only the exact credentials used at setup can decrypt, so this is as safe as one try.
  function credVariants(user, pw) {
    const u = user.trim();
    const users = [...new Set([u, u.toLowerCase(), u.charAt(0).toLowerCase() + u.slice(1), u.charAt(0).toUpperCase() + u.slice(1)])];
    const pws = [...new Set([pw, pw.trim()])];
    const out = []; for (const uu of users) for (const pp of pws) out.push([uu, pp]); return out;
  }
  async function openForgiving(env, user, pw, first) {
    let last;
    for (const [uu, pp] of (first ? [first, ...credVariants(user, pw)] : credVariants(user, pw))) {
      try { await open(env, uu, pp); return [uu, pp]; } catch (e) { last = e; }
    }
    throw last;
  }

  /* ---------- GitHub storage ---------- */
  // The GitHub token is stored on this device ENCRYPTED with your login key, so other pages on
  // ant56-arch.github.io (your other sites) cannot use it. It is only unlocked in memory after login.
  let memToken = '', tokKey = null, tokSalt = null;
  const tok = () => memToken;
  async function setTokKey(user, pw) { tokSalt = crypto.getRandomValues(new Uint8Array(16)); tokKey = await derive(user, pw, tokSalt, 600000); }
  async function storeToken(v) {
    memToken = v || '';
    try {
      localStorage.removeItem('gcj_token'); localStorage.removeItem('gcj_token_enc');   // older formats: never keep them
      if (!memToken) { localStorage.removeItem('gcj_tok2'); return; }
      if (!tokKey) return;
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, tokKey, new TextEncoder().encode(memToken)));
      localStorage.setItem('gcj_tok2', JSON.stringify({ s: b64e(tokSalt), i: b64e(iv), d: b64e(ct) }));
    } catch { /* storage unavailable: token stays for this visit only */ }
  }
  const storedTok2 = () => { try { return JSON.parse(localStorage.getItem('gcj_tok2') || 'null'); } catch { return null; } };
  const hasStoredToken = () => { try { return !!(localStorage.getItem('gcj_tok2') || localStorage.getItem('gcj_token_enc') || localStorage.getItem('gcj_token')); } catch { return false; } };
  async function readTok2(t, user, pw) {
    const salt = b64d(t.s), key = await derive(user, pw, salt, 600000);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(t.i) }, key, b64d(t.d));
    return { token: new TextDecoder().decode(pt), key, salt };
  }
  async function unlockLegacyToken() {   // older versions: readable, or locked with the data key (needs the data open)
    try {
      const legacy = localStorage.getItem('gcj_token'); if (legacy) return legacy;
      const e = localStorage.getItem('gcj_token_enc'); if (!e) return '';
      return new TextDecoder().decode(await decBytes(b64d(e)));
    } catch { return ''; }
  }
  const hdr = () => ({ Authorization: `Bearer ${tok()}`, Accept: 'application/vnd.github+json' });
  const authWhy = (status, repo) => ({
    401: 'GitHub says this token is expired or not valid, so you need a new one. Make it on GitHub the same way as before.',
    403: 'This token can read your data but is not allowed to save it. On GitHub, edit the token and set Contents to “Read and write”.',
    404: `This token does not include the ${repo} repository. On GitHub, edit the token and add ${repo} under Repository access.`,
  })[status] || 'GitHub refused this token.';
  const authErr = (status, repo = DATA.repo) => Object.assign(new Error('auth'), { auth: true, status, why: authWhy(status, repo) });
  async function stGetMeta(st, path) {
    const r = await fetch(`${repoApi(st)}${path}?${refQ(st)}t=${Date.now()}`, { headers: hdr(), cache: 'no-store' });
    if (r.status === 404) return null;
    if (r.status === 401 || r.status === 403) throw authErr(r.status, st.repo);
    if (!r.ok) throw new Error('GitHub ' + r.status);
    return r.json();
  }
  async function stGetRaw(st, path) {
    const r = await fetch(`${repoApi(st)}${path}?${refQ(st)}t=${Date.now()}`, { headers: { ...hdr(), Accept: 'application/vnd.github.raw+json' }, cache: 'no-store' });
    if (r.status === 404) return null;
    if (r.status === 401 || r.status === 403) throw authErr(r.status, st.repo);
    if (!r.ok) throw new Error('GitHub ' + r.status);
    return new Uint8Array(await r.arrayBuffer());
  }
  async function stPut(st, path, b64, sha, message) {
    const body = { message, content: b64, committer: COMMITTER, author: COMMITTER };
    if (st.branch) body.branch = st.branch;
    if (sha) body.sha = sha;
    const r = await fetch(repoApi(st) + path, { method: 'PUT', headers: { ...hdr(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (r.status === 409 || r.status === 422) throw Object.assign(new Error('conflict'), { conflict: true });
    if (r.status === 401 || r.status === 403 || r.status === 404) throw authErr(r.status, st.repo);
    if (!r.ok) throw new Error('GitHub ' + r.status);
    return (await r.json()).content.sha;
  }
  async function stDelete(st, path, message) {
    const m = await stGetMeta(st, path); if (!m) return;
    const body = { message, sha: m.sha, committer: COMMITTER, author: COMMITTER };
    if (st.branch) body.branch = st.branch;
    const r = await fetch(repoApi(st) + path, { method: 'DELETE', headers: { ...hdr(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok && r.status !== 404) throw new Error('GitHub ' + r.status);
  }
  async function ghGet() {
    const j = await stGetMeta(DATA, DATA.vault);
    if (!j) return null;
    if (!j.content) { const raw = await stGetRaw(DATA, DATA.vault); return { sha: j.sha, text: new TextDecoder().decode(raw) }; }
    return { sha: j.sha, text: atob(j.content.replace(/\n/g, '')) };
  }
  const COMMITTER = { name: 'Cookie Jar portal', email: 'cookie-jar-portal@users.noreply.github.com' };
  const ghPut = (text, sha) => stPut(DATA, DATA.vault, btoa(text), sha, 'Update portal data');
  async function fetchPublicEnv() {   // the copy published with the website (public storage only)
    const r = await fetch('data/portal.enc.json', { cache: 'no-store' });
    if (!r.ok) return null;
    S.sha = null;
    return r.json();
  }

  // ---------- photos: private, encrypted storage ----------
  let ghChain = Promise.resolve();
  const withLock = (fn) => { const run = ghChain.then(fn); ghChain = run.catch(() => {}); return run; }; // GitHub needs writes one at a time
  function bytesToB64(u8) { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
  async function encBytes(u8) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, S.key, u8));
    const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12); return out;
  }
  const decBytes = async (u8) => new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: u8.slice(0, 12) }, S.key, u8.slice(12)));
  async function ghPutFile(path, u8) {
    try { await stPut(DATA, path, bytesToB64(u8), null, 'Add photo'); }
    catch (e) { if (e.auth) { S.authWhy = e.why; throw new Error(e.why); } throw e; }
  }
  const ghDeleteFile = (path) => stDelete(DATA, path, 'Remove photo');
  const photoCache = new Map();
  function photoUrl(id, kind) {
    const key = id + kind;
    if (!photoCache.has(key)) {
      photoCache.set(key, (async () => {
        const path = `${DATA.photos}/${id}.${kind}.bin`;
        let bytes;
        if (tok()) bytes = await stGetRaw(DATA, path).catch(() => null);
        if (!bytes && DATA === STORES.public) {
          const r = await fetch(`${path}?t=${Date.now()}`, { cache: 'no-store' });
          if (!r.ok) throw new Error('missing');
          bytes = new Uint8Array(await r.arrayBuffer());
        }
        return URL.createObjectURL(new Blob([await decBytes(bytes)], { type: 'image/jpeg' }));
      })().catch((e) => { photoCache.delete(key); throw e; }));
    }
    return photoCache.get(key);
  }
  let loadActive = 0; const loadWaiting = [];
  const limitLoad = (fn) => new Promise((res, rej) => {
    const run = () => { loadActive++; fn().then(res, rej).finally(() => { loadActive--; const n = loadWaiting.shift(); if (n) n(); }); };
    loadActive < 4 ? run() : loadWaiting.push(run);
  });
  function lazyThumbs(root) {
    const load = (el) => limitLoad(() => photoUrl(el.dataset.pid, 't')).then((u) => { el.style.backgroundImage = `url("${u}")`; el.classList.add('loaded'); }).catch(() => el.classList.add('missing'));
    if (!('IntersectionObserver' in window)) { root.querySelectorAll('[data-pid]').forEach(load); return; }
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { io.unobserve(e.target); load(e.target); } }), { rootMargin: '200px' });
    root.querySelectorAll('[data-pid]').forEach((el) => io.observe(el));
  }
  async function makeVersions(file) {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const jpeg = (max, q) => {
      const r = Math.min(1, max / Math.max(bmp.width, bmp.height)), w = Math.max(1, Math.round(bmp.width * r)), h = Math.max(1, Math.round(bmp.height * r));
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d').drawImage(bmp, 0, 0, w, h);
      return new Promise((res) => c.toBlob((b) => res({ blob: b, w, h }), 'image/jpeg', q));
    };
    const full = await jpeg(1600, 0.82), thumb = await jpeg(480, 0.72);
    bmp.close && bmp.close();
    return { full, thumb };
  }
  const photos = () => (S.vault.photos ||= []);
  const photoCount = (orderId) => photos().filter((p) => p.orderId === orderId).length;
  const photoById = (id) => photos().find((p) => p.id === id);

  const normEnv = (txt) => { try { return JSON.stringify(JSON.parse(txt)); } catch { return txt; } };
  // Take in a newer version saved by another device (same login).
  async function adoptRemote(g) {
    const env = JSON.parse(g.text);
    if (env.salt !== b64e(S.salt) || env.iter !== S.iter) throw Object.assign(new Error('rekeyed'), { rekeyed: true });
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(env.iv) }, S.key, b64d(env.data));
    S.vault = JSON.parse(new TextDecoder().decode(plain)); S.sha = g.sha; S.loaded = normEnv(g.text);
  }
  let rekeyWarned = false;
  async function refreshFromRemote() {
    if (!S.vault || !tok() || S.dirty || saving || migrating || !navigator.onLine || document.querySelector('dialog[open]')) return;
    try {
      const g = await ghGet();
      if (!g || g.sha === S.sha) return;
      if (normEnv(g.text) === S.loaded) { S.sha = g.sha; return; }
      if (S.dirty || saving || document.querySelector('dialog[open]')) return;
      await adoptRemote(g); render(); setSave('saved');
      toast('Updated with changes from your other device.');
    } catch (e) {
      if (e.rekeyed && !rekeyWarned) { rekeyWarned = true; toast('Your username or password was changed on another device. Lock and log in again to see the latest data.', { kind: 'bad', ms: 9000 }); }
    }
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshFromRemote(); });
  setInterval(refreshFromRemote, 180000);
  let conflictWarned = false, migrating = false;
  async function migrateToPrivate() {
    const pub = STORES.public, priv = STORES.private;
    if (!priv || !tok() || migrating) return;
    migrating = true; setSave('saving');
    const prev = { sha: S.sha, loaded: S.loaded }; let wrote = false;
    toast('Moving your data to your private repository…', { ms: 4000 });
    try {
      if (await stGetMeta(priv, priv.vault)) {   // another device already moved it: use that copy, never overwrite
        DATA = priv; S.sha = null; migrating = false; await refreshFromRemote(); return;
      }
      const cur = await stGetMeta(pub, pub.vault);   // make sure we move the newest version, not a stale copy
      if (cur) {
        const g = { sha: cur.sha, text: cur.content ? atob(cur.content.replace(/\n/g, '')) : new TextDecoder().decode(await stGetRaw(pub, pub.vault)) };
        if (normEnv(g.text) !== S.loaded) {
          if (S.dirty) throw new Error('another device has newer changes. Lock, log in again, and it will try again');
          await adoptRemote(g);
        }
        S.sha = g.sha;
      }
      for (const ph of photos()) for (const k of ['f', 't']) {   // photos first (already encrypted, copied as-is)
        const name = `${ph.id}.${k}.bin`;
        if (await stGetMeta(priv, `${priv.photos}/${name}`)) continue;
        const bytes = await stGetRaw(pub, `${pub.photos}/${name}`); if (!bytes) continue;
        await withLock(() => stPut(priv, `${priv.photos}/${name}`, bytesToB64(bytes), null, 'Move photo to private storage'));
      }
      const text = await seal();
      const sha = await withLock(() => stPut(priv, priv.vault, btoa(text), null, 'Move portal data to private storage'));
      DATA = priv; S.sha = sha; S.loaded = normEnv(text); wrote = true;   // from here on the private copy is the real one
      const g = await ghGet();
      if (!g || normEnv(g.text) !== S.loaded) throw new Error('the new copy could not be checked');
      for (const ph of photos()) for (const k of ['f', 't']) await withLock(() => stDelete(pub, `${pub.photos}/${ph.id}.${k}.bin`, 'Remove public photo copy')).catch(() => {});
      await withLock(() => stDelete(pub, pub.vault, 'Remove public data copy (moved to private storage)'));
      S.dirty = false; setSave('saved');
      toast('✓ Your data now lives in your private repository. Nobody else can download it.', { ms: 9000 });
      if (S.tab === 'settings') render();
    } catch (e) {
      if (!wrote) { DATA = pub; S.sha = prev.sha; S.loaded = prev.loaded; }
      setSave(e && e.auth ? 'auth' : 'saved');
      if (e && e.auth) S.authWhy = e.why;
      toast(e && e.auth ? `Could not move your data yet. ${e.why}` : `Could not move your data yet (${(e && e.message) || 'unknown problem'}). It is still safe where it was, and the portal will try again next time you log in.`, { kind: 'bad', ms: 12000 });
    } finally { migrating = false; if (S.dirty) save(); }
  }
  let saving = false, again = false, timer = null, retryTimer = null;
  window.addEventListener('online', () => { if (S.vault && S.dirty) save(); else if (S.vault) setSave(tok() ? 'saved' : 'local'); });
  window.addEventListener('offline', () => { if (S.vault) setSave('offline'); });
  function setSave(state) {
    const el = $('#savestate'); if (!el) return;
    const m = {
      saved: ['Saved ✓', ''], saving: ['Saving…', ''], dirty: ['Unsaved changes…', ''],
      local: ['⚠ Not saved', 'bad'],
      conflict: ['⚠ Changed elsewhere', 'bad'],
      auth: ['⚠ Token rejected', 'bad'], error: ['⚠ Save failed', 'bad'],
      offline: ['Offline · will save when you reconnect', 'warn'],
    }[state] || ['', ''];
    el.textContent = m[0]; el.className = 'savestate ' + m[1]; el.title = m[1] ? 'Tap to fix' : '';
  }
  function touch() {
    S.dirty = true;
    setSave(tok() ? 'dirty' : 'local');
    clearTimeout(timer);
    timer = setTimeout(save, 700);
  }
  async function save() {
    if (!tok()) { setSave('local'); return; }
    if (migrating) { clearTimeout(timer); timer = setTimeout(save, 1500); return; }
    if (!navigator.onLine) { setSave('offline'); return; }
    if (saving) { again = true; return; }
    saving = true; setSave('saving');
    try {
      const text = await seal();
      if (!S.sha) {
        const g = await ghGet();
        if (g && normEnv(g.text) !== S.loaded) throw Object.assign(new Error('conflict'), { conflict: true }); // GitHub has something newer
        S.sha = g ? g.sha : undefined;
      }
      S.sha = await withLock(() => ghPut(text, S.sha));
      S.loaded = normEnv(text); S.dirty = false; S.authWhy = ''; setSave('saved');
    } catch (e) {
      if (e.auth) S.authWhy = e.why;
      setSave(e.conflict ? 'conflict' : e.auth ? 'auth' : navigator.onLine ? 'error' : 'offline');
      if (e.conflict && !conflictWarned) { conflictWarned = true; toast('Another device saved newer changes, so nothing was overwritten. Tap “Changed elsewhere” at the top to load them.', { kind: 'bad', ms: 10000 }); }
      if (!e.conflict && !e.auth) { clearTimeout(retryTimer); retryTimer = setTimeout(() => { if (S.dirty) save(); }, 20000); } // try again shortly
    } finally {
      saving = false;
      if (again) { again = false; save(); }
    }
  }
  window.addEventListener('beforeunload', (e) => { if (S.dirty) { e.preventDefault(); e.returnValue = ''; } });

  /* ---------- workbook import ---------- */
  function loadScript(src) {
    return new Promise((res, rej) => {
      if (window.XLSX) return res();
      const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load importer'));
      document.head.appendChild(s);
    });
  }
  const fixDate = (d) => isoDate(new Date(d.getTime() + 12 * 3600e3)); // guards against off-by-seconds/timezone drift
  function cleanGrid(rows) {
    rows = (rows || []).map((r) => r.map((c) => (c instanceof Date ? fixDate(c) : c)));
    rows = rows.filter((r) => r.some((c) => c !== null && c !== ''));
    if (!rows.length) return [];
    const w = Math.max(...rows.map((r) => r.reduce((m, c, i) => (c !== null && c !== '' ? i + 1 : m), 0)));
    return rows.map((r) => Array.from({ length: w }, (_, i) => r[i] ?? null));
  }
  function toOrders(rows) {
    const head = rows[0].map((h) => String(h || '').trim());
    const ix = Object.fromEntries(head.map((h, i) => [h, i]));
    const g = (r, n) => (ix[n] === undefined ? null : r[ix[n]] ?? null);
    const dt = (v) => (v instanceof Date ? fixDate(v) : '');
    const str = (v) => (v === null || v === undefined ? '' : String(v).trim());
    const numOrNull = (v) => (v === null || v === '' || !Number.isFinite(+v) ? null : +v);
    const today = todayISO();
    const out = [];
    for (const r of rows.slice(1)) {
      const name = str(g(r, 'Name'));
      if (!name) continue;
      const pick = g(r, 'Pickup Date');
      const due = dt(pick);
      const done = str(g(r, 'Completed')) === 'Completed';
      let status = 'Completed', reason = '';
      if (!done) {
        status = 'Declined';
        const t = typeof pick === 'string' ? pick.trim() : '';
        reason = t ? t.charAt(0).toUpperCase() + t.slice(1).toLowerCase() : '';
      } else if (due && due > today) status = 'Confirmed';
      const row = {
        id: crypto.randomUUID().slice(0, 8), name, contact: '', status, reason,
        requested: dt(g(r, 'Date Order Requested')), due,
        qty: numOrNull(g(r, 'Amt of Cookies')), price: numOrNull(g(r, 'Price Quoted/Each')),
        addOns: str(g(r, 'Add Ons')), addOnsAmt: numOrNull(g(r, 'Add Ons Amt')),
        rush: numOrNull(g(r, 'Rush fee amt ($5/dozen)')),
        amtDue: numOrNull(g(r, 'Amt Due')), paid: numOrNull(g(r, 'Total Paid Amt')), method: str(g(r, 'Method of Payment')),
        event: str(g(r, 'Event')), type: str(g(r, 'Type of Event')), colors: str(g(r, 'Any special colors')),
        allergies: str(g(r, 'Allergies')) === 'N/A' ? '' : str(g(r, 'Allergies')),
        kind: str(g(r, 'Custom/Premade')), designs: numOrNull(g(r, '# of Designs')), numColors: numOrNull(g(r, '# of Colors')),
        myChoice: str(g(r, 'My choice of cookie')),
        notes: [str(g(r, 'Color Notes')), str(g(r, 'Notes'))].filter(Boolean).join(' · '),
      };
      tidyOrder(row);
      out.push(row);
    }
    return out;
  }
  async function importWorkbook(file) {
    await loadScript('vendor/xlsx.full.min.js');
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
    const grid = (n) => (wb.Sheets[n] ? XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: null }) : null);
    const src = grid('Enter Cookie Orders') || grid('Complete Orders');
    const ref = {};
    wb.SheetNames.filter((n) => !REF_SKIP.includes(n)).forEach((n) => { const c = cleanGrid(grid(n)); if (c.length) ref[n] = c; });
    return { orders: src ? toOrders(src) : [], ref };
  }

  /* ---------- gate (login / first-time setup) ---------- */
  async function showGate() {
    const gate = $('#gate');
    gate.innerHTML = '<p class="muted">Loading…</p>';
    try { S.site = await fetch('data/site.json', { cache: 'no-store' }).then((r) => r.json()); } catch { S.site = null; }
    if (S.site && S.site.dataRepo) {   // data lives in a private repository: always a login (a token unlocks it)
      STORES.private = { repo: S.site.dataRepo, vault: 'portal.enc.json', photos: 'photos', branch: null };
      loginForm(null); return;
    }
    let env = null;
    try { env = await fetchPublicEnv(); } catch { /* treated as none */ }
    env ? loginForm(env) : setupForm();
  }

  const brandBlock = () => `<div class="gate-brand"><svg class="jar" aria-hidden="true"><use href="#i-jar"/></svg>
      <div class="brand-name">Gina's Cookie Jar</div><div class="muted">Owner portal</div></div>`;

  const WRONG = 'That username and password did not match. Check capital letters and spaces. Tap “Show password” to see what you typed.';
  async function doLogin(env, user, pw, typedToken) {
    let token = typedToken, win = null;
    const t2 = storedTok2();
    if (!token && t2) {
      for (const [u, p] of credVariants(user, pw)) {
        try { const r = await readTok2(t2, u, p); token = r.token; tokKey = r.key; tokSalt = r.salt; win = [u, p]; break; } catch { /* next */ }
      }
    }
    memToken = token || '';
    let fromPublic = false;
    if (STORES.private) {
      DATA = STORES.private;
      if (memToken) {
        try { const g = await ghGet(); if (g) { env = JSON.parse(g.text); S.sha = g.sha; } }
        catch (e) { if (e.auth) throw Object.assign(new Error(e.why), { showTok: true }); throw new Error('GitHub could not be reached. Check your internet connection and try again.'); }
      }
      if (!env) {   // not moved yet (or no token on this device): use the copy published with the website
        DATA = STORES.public;
        env = await fetchPublicEnv().catch(() => null);
        fromPublic = !!env;
      }
      if (!env) {
        if (t2 && !win && !typedToken) throw Object.assign(new Error(WRONG + ' If you changed your password on another device, also paste your GitHub token.'), { showTok: true });
        throw Object.assign(new Error(memToken ? `Your data was not found in ${STORES.private.repo}. Check that your token includes that repository.` : 'Paste your GitHub token below to open your data on this device.'), { showTok: true });
      }
    }
    let opened;
    try { opened = await openForgiving(env, user, pw, win); }
    catch { throw Object.assign(new Error(WRONG), { showTok: false }); }
    if (!memToken) memToken = await unlockLegacyToken();
    if (!tokKey || !win || win[0] !== opened[0] || win[1] !== opened[1]) await setTokKey(opened[0], opened[1]);
    if (memToken) await storeToken(memToken);   // (re)lock the token with this login
    else { try { localStorage.removeItem('gcj_token_enc'); } catch { /* ignore */ } }
    return { fromPublic };
  }

  function loginForm(env) {
    $('#gate').innerHTML = `<form id="lf" class="gate-card">${brandBlock()}
      <h1>Welcome back</h1>
      <label>Username<input id="u" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" required></label>
      <label>Password<input id="p" type="password" autocomplete="current-password" autocapitalize="none" autocorrect="off" spellcheck="false" required></label>
      <label class="check showpw"><input type="checkbox" id="showpw"> Show password</label>
      ${STORES.private ? `<label id="tokrow"${hasStoredToken() ? ' hidden' : ''}>GitHub token <span class="muted small">(only needed the first time on this device)</span><input id="t2" type="password" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="github_pat_…"></label>` : ''}
      <button class="btn full" type="submit" id="unlock">Unlock</button>
      <div class="err" id="err" role="alert"></div>
      <p class="muted small">Your data is encrypted; it's only decrypted in this browser.</p></form>`;
    try { const m = sessionStorage.getItem('gcj_locked'); if (m) $('#err').textContent = `Locked after ${m} minutes of no use. Log in again to continue.`; } catch { /* ignore */ }
    $('#showpw').addEventListener('change', (e) => { $('#p').type = e.target.checked ? 'text' : 'password'; });
    $('#lf').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $('#unlock');
      $('#err').textContent = '';
      btn.disabled = true; btn.textContent = 'Checking…';
      await new Promise((r) => setTimeout(r, 30)); // let the button repaint before the heavy work
      let result;
      try { result = await doLogin(env, $('#u').value, $('#p').value, (($('#t2') || {}).value || '').replace(/\s+/g, '')); }
      catch (ex) {
        btn.disabled = false; btn.textContent = 'Unlock';
        $('#err').textContent = ex.message || 'Something went wrong. Try again.';
        if (ex.showTok && $('#tokrow')) $('#tokrow').hidden = false;
        return;
      }
      try { if (sessionStorage.getItem('gcj_locked')) sessionStorage.removeItem('gcj_locked'); } catch { /* ignore */ }
      enterApp(tok() ? 'saved' : 'local');
      if (result.fromPublic && STORES.private && tok()) migrateToPrivate();
      else if (tok()) refreshFromRemote();   // pick up anything newer than the copy we opened
    });
  }

  function setupForm() {
    $('#gate').innerHTML = `<form id="sf" class="gate-card">${brandBlock()}
      <h1>Set up your portal</h1>
      <p class="muted small">No data exists yet. Choose a login and (optionally) import your Excel workbook. Everything is encrypted before it is saved.</p>
      <label>Username<input id="u" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" required></label>
      <label>Password (12+ characters — a passphrase is best)<input id="p" type="password" autocomplete="new-password" required minlength="12"></label>
      <label>Repeat password<input id="p2" type="password" autocomplete="new-password" required minlength="12"></label>
      <label>Import your workbook (.xlsx) — optional<input id="f" type="file" accept=".xlsx,.xls"></label>
      <label>GitHub token (for saving — can add later in Settings)<input id="t" type="password" placeholder="github_pat_…"></label>
      <button class="btn full" type="submit">Create portal</button>
      <div class="err" id="err" role="alert"></div></form>`;
    $('#sf').addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = (m) => ($('#err').textContent = m);
      err('');
      if ($('#p').value !== $('#p2').value) return err('Passwords do not match.');
      try {
        const file = $('#f').files[0];
        const data = file ? await importWorkbook(file) : { orders: [], ref: {} };
        S.vault = { v: 2, orders: data.orders, ref: data.ref };
        S.salt = crypto.getRandomValues(new Uint8Array(16));
        S.key = await derive($('#u').value.trim(), $('#p').value, S.salt, S.iter);
        const t = $('#t').value.trim();
        await setTokKey($('#u').value.trim(), $('#p').value);
        const tt = t ? t.replace(/\s+/g, '') : await unlockLegacyToken();   // keep (and lock) a token this device already had
        if (tt) await storeToken(tt);
        S.sha = null; S.dirty = true;
        enterApp(tok() ? 'dirty' : 'local');
        if (tok()) save();
      } catch (ex) { err(ex.message || 'Setup failed.'); }
    });
  }

  function enterApp(state) {
    $('#gate').hidden = true; $('#app').hidden = false; window.scrollTo(0, 0);
    const want = location.hash.slice(1); if (['home', 'orders', 'customers', 'calendar', 'photos', 'money', 'calculator', 'workbook', 'settings', 'more'].includes(want)) S.tab = want;
    setSave(state);
    loadSite().then(render);
    render();
    requestAnimationFrame(() => window.scrollTo(0, 0));
  }
  async function loadSite() { if (!S.site) { try { S.site = await fetch('data/site.json').then((r) => r.json()); } catch { /* ignore */ } } }

  /* ---------- tabs ---------- */
  function render() {
    const moreSet = ['more', 'customers', 'photos', 'calculator', 'workbook', 'settings'];
    document.querySelectorAll('#tabs button').forEach((b) => b.setAttribute('aria-current', String(b.dataset.tab === S.tab)));
    document.querySelectorAll('#bottomnav button').forEach((b) => b.setAttribute('aria-current', String(b.dataset.tab === S.tab || (b.dataset.tab === 'more' && moreSet.includes(S.tab)))));
    const main = $('#main');
    const views = { home: viewHome, more: viewMore, photos: viewPhotos, customers: viewCustomers, orders: viewOrders, calendar: viewCalendar, money: viewMoney, calculator: viewCalculator, workbook: viewWorkbook, settings: viewSettings };
    (views[S.tab] || viewHome)(main);
  }

  /* ---------- orders ---------- */
  const balance = (o) => num(o.amtDue) - num(o.paid);
  const byId = (id) => S.vault.orders.find((o) => o.id === id);

  const noOcc = (o) => o.status !== 'Declined' && !(o.type || '').trim();
  const owes = (o) => o.status !== 'Declined' && o.amtDue != null && balance(o) > 0.005;
  function viewOrders(main) {
    const orders = S.vault.orders, today = todayISO();
    const active = orders.filter((o) => OPEN.includes(o.status));
    const owed = orders.filter(owes);
    const years = [...new Set(orders.map((o) => (o.due || o.requested || '').slice(0, 4)).filter(Boolean))].sort().reverse();
    const next = active.filter((o) => o.due && o.due >= today).sort((a, b) => a.due.localeCompare(b.due))[0];
    const count = (st) => orders.filter((o) => o.status === st).length;
    const chip = (k, l, c) => `<button class="chip" data-f="${k}" aria-selected="${S.filter === k}">${l}${c == null ? '' : ` (${c})`}</button>`;
    const board = S.oview === 'board';
    const yearSel = `<select id="oyear" aria-label="Year"><option value="All">All years</option>${years.map((y) => `<option${S.oyear === y ? ' selected' : ''}>${y}</option>`).join('')}</select>`;
    main.innerHTML = `${pageHead('Orders', `${plural(orders.length - count('Declined'), 'order')} · ${active.length} active`,
      `<div class="seg" role="group" aria-label="View"><button data-oview="list" aria-pressed="${!board}">List</button><button data-oview="board" aria-pressed="${board}">Board</button></div><button class="btn small" data-new>+ New order</button>`)}
      <div class="kpis">
        <div class="kpi"><b>${active.length}</b><span>Active orders</span></div>
        <div class="kpi"><b>${active.reduce((s, o) => s + num(o.qty), 0).toLocaleString()}</b><span>Cookies to bake</span></div>
        <div class="kpi"><b class="${owed.length ? 'neg' : ''}">${money(owed.reduce((s, o) => s + balance(o), 0))}</b><span>Owed to you (${owed.length})</span></div>
        <div class="kpi"><b style="font-size:1.05rem">${next ? esc(fmtDate(next.due)) : '—'}</b><span>${next ? 'Next: ' + esc(short(next.name)) : 'No upcoming pickups'}</span></div>
      </div>
      <div class="bar"><input class="grow" id="q" type="search" placeholder="Search name, phone, event, notes…" value="${esc(S.q)}">${board ? yearSel : ''}</div>
      ${board ? `<p class="muted small drop-tip">Drag a card to another column to change its status.</p><div id="board" class="board"></div>` : `<div class="bar">
        ${chip('Orders', 'Orders', orders.length - count('Declined'))}${chip('Active', 'Active', active.length)}${chip('Owes', 'Owes money', owed.length)}${chip('Completed', 'Completed', count('Completed'))}${chip('Declined', 'Declined', count('Declined'))}${chip('NoOcc', 'No occasion', orders.filter(noOcc).length)}
        <span class="sp"></span>
        ${yearSel}
        <select id="osort" aria-label="Sort">${[['newest', 'Newest first'], ['oldest', 'Oldest first'], ['due', 'Due date'], ['total', 'Highest total'], ['name', 'Customer A–Z']].map(([v, l]) => `<option value="${v}"${S.sort === v ? ' selected' : ''}>${l}</option>`).join('')}</select>
        <button class="btn ghost small" id="csv" type="button" title="Download the orders shown as a spreadsheet">Export CSV</button>
      </div>
      <p class="muted small drop-tip">Tip: drag pictures from your computer onto any order below to attach them to it.</p>
      <div id="list" class="olist"></div>
      ${S.filter === 'Orders' ? `<p class="muted small">${count('Declined')} cancelled / no-order inquiries are hidden — see the Declined filter.</p>` : ''}`}`;
    drawOrders();
  }
  function setStatus(o, st) {
    const prev = o.status;
    if (!o || prev === st) return;
    o.status = st; touch(); render();
    toast(`${o.name} moved to ${st}`, { action: 'Undo', onAction: () => { o.status = prev; touch(); render(); } });
  }
  const drawOrders = () => (S.oview === 'board' ? drawBoard() : drawList());

  const BOARD_COLS = ['Requested', 'Confirmed', 'Baking', 'Ready', 'Completed'];
  function drawBoard() {
    const el = $('#board'); if (!el) return;
    const q = S.q.toLowerCase(), y = S.oyear, today = todayISO();
    const match = (o) => (y === 'All' || (o.due || o.requested || '').startsWith(y))
      && (!q || [o.name, o.event, o.type, o.notes, o.colors, o.phone, o.email, o.social, o.contact].join(' ').toLowerCase().includes(q));
    const card = (o) => {
      const bal = balance(o), over = OPEN.includes(o.status) && o.due && o.due < today, pc = photoCount(o.id);
      return `<article class="bcard st-${o.status}" draggable="true" data-id="${o.id}">
        <div class="bc-top"><b>${esc(o.name)}</b>${num(o.rush) > 0 ? '<span class="pill rush">⚡ Rush</span>' : ''}</div>
        <div class="bc-sub">${esc(o.event || o.type || '')}</div>${o.phone ? `<a class="bc-contact" href="${esc(telHref(o.phone))}">${ico('phone')}${esc(o.phone)}</a>` : o.email ? `<a class="bc-contact" href="mailto:${esc(o.email)}">${ico('mail')}${esc(o.email)}</a>` : ''}
        <div class="bc-meta"><span class="${over ? 'neg' : ''}">${o.due ? esc(fmtDate(o.due)) + (OPEN.includes(o.status) ? esc(relDue(o.due, today)) : '') : 'No date'}</span><span>${cookiesOf(o.qty)}</span></div>
        <div class="bc-foot"><span>${o.amtDue == null ? '' : money(o.amtDue)}</span>${o.amtDue == null ? '' : bal > 0.005 ? `<span class="neg">${money(bal)} due</span>` : '<span class="ok">✓ Paid</span>'}${pc ? `<span>📷 ${pc}</span>` : ''}</div>
        <select class="bc-move" data-sid="${o.id}" aria-label="Move to">${STATUSES.map((st) => `<option${st === o.status ? ' selected' : ''}>${st}</option>`).join('')}</select></article>`;
    };
    el.innerHTML = BOARD_COLS.map((st) => {
      let list = S.vault.orders.filter((o) => o.status === st && match(o));
      const total = list.length, cookies = list.reduce((t, o) => t + num(o.qty), 0);
      list = st === 'Completed' ? list.sort(newestFirst).slice(0, 8) : list.sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'));
      return `<section class="bcol st-${st}" data-col="${st}"><div class="bhead"><span class="bdot"></span><b>${st}</b><span class="bcount">${total}</span></div>
        ${total ? `<div class="bsum muted small">${plural(cookies, 'cookie')}</div>` : ''}
        <div class="bcards">${list.map(card).join('') || '<p class="muted small" style="margin:6px">Nothing here.</p>'}</div>
        ${st === 'Completed' && total > list.length ? `<p class="muted small" style="margin:8px 6px 0">Showing the latest ${list.length} of ${total}. Use the List view to see all.</p>` : ''}</section>`;
    }).join('');
    const hot = (c) => el.querySelectorAll('.col-hot').forEach((x) => x !== c && x.classList.remove('col-hot'));
    el.ondragstart = (e) => { const c = e.target.closest('.bcard'); if (!c) return; e.dataTransfer.setData('text/plain', c.dataset.id); e.dataTransfer.effectAllowed = 'move'; setTimeout(() => c.classList.add('dragging'), 0); };
    el.ondragend = () => { el.querySelectorAll('.dragging').forEach((x) => x.classList.remove('dragging')); hot(null); el.querySelectorAll('.col-hot').forEach((x) => x.classList.remove('col-hot')); };
    el.ondragover = (e) => { if (hasFiles(e)) return; const c = e.target.closest('.bcol'); if (!c) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; hot(c); c.classList.add('col-hot'); };
    el.ondrop = (e) => {
      if (hasFiles(e)) return;
      const c = e.target.closest('.bcol'); if (!c) return;
      e.preventDefault();
      const o = byId(e.dataTransfer.getData('text/plain'));
      if (o && o.status !== c.dataset.col) setStatus(o, c.dataset.col); else el.ondragend();
    };
  }

  function filtered() {
    const f = S.filter, q = S.q.toLowerCase(), y = S.oyear;
    return S.vault.orders.filter((o) => {
      if (f === 'Orders' && o.status === 'Declined') return false;
      if (f === 'Active' && !OPEN.includes(o.status)) return false;
      if (f === 'Owes' && !owes(o)) return false;
      if (f === 'Completed' && o.status !== 'Completed') return false;
      if (f === 'Declined' && o.status !== 'Declined') return false;
      if (f === 'NoOcc' && !noOcc(o)) return false;
      if (y !== 'All' && !(o.due || o.requested || '').startsWith(y)) return false;
      if (q && ![o.name, o.event, o.type, o.notes, o.contact, o.phone, o.email, o.social, o.reason, o.method, o.colors].join(' ').toLowerCase().includes(q)) return false;
      return true;
    });
  }
  const when = (o) => o.due || o.requested || '';
  const SORTS = {
    newest: (a, b) => when(b).localeCompare(when(a)),
    oldest: (a, b) => (when(a) || '9999').localeCompare(when(b) || '9999'),
    due: (a, b) => (a.due || '9999').localeCompare(b.due || '9999'),
    total: (a, b) => num(b.amtDue) - num(a.amtDue),
    name: (a, b) => a.name.localeCompare(b.name),
  };

  function orow(o) {
    const bal = balance(o), dec = o.status === 'Declined';
    return `<div class="orow st-${o.status}" data-id="${o.id}">
      <span class="c-due">${esc(fmtDate(o.due)) || '<span class="muted">No date</span>'}</span>
      <span class="c-name"><b>${esc(o.name)}</b>${photoCount(o.id) ? ` <span class="pill" title="Photos">📷 ${photoCount(o.id)}</span>` : ''}${num(o.rush) > 0 ? ' <span class="pill rush">⚡ Rush</span>' : ''}${o.allergies ? ` <span class="pill warn" title="${esc(o.allergies)}">⚠ ${esc(o.allergies)}</span>` : ''}
        <small>${esc(dec ? o.reason : (o.event || o.type))}${!dec && (o.phone || o.email) ? `${o.event || o.type ? ' · ' : ''}<a href="${esc(o.phone ? telHref(o.phone) : 'mailto:' + o.email)}">${esc(o.phone || o.email)}</a>` : ''}</small></span>
      <span class="c-qty">${dec || o.qty == null ? '' : o.qty}</span>
      <span class="c-total">${dec || o.amtDue == null ? '' : money(o.amtDue)}</span>
      <span class="c-paid">${dec || o.paid == null ? '' : money(o.paid)}${(o.payments || []).length > 1 ? `<small>${o.payments.length} payments</small>` : ''}</span>
      <span class="c-bal ${!dec && bal > 0.005 ? 'neg' : 'muted'}">${dec || o.amtDue == null ? '' : bal > 0.005 ? money(bal) + ' due' : '✓ paid'}</span>
      <span class="c-st"><select class="st-sel st-${o.status}" data-sid="${o.id}" aria-label="Status">${STATUSES.map((s) => `<option${s === o.status ? ' selected' : ''}>${s}</option>`).join('')}</select></span>
    </div>`;
  }

  function drawList() {
    let list = filtered();
    const grouped = S.filter === 'Orders' && S.sort === 'newest' && !S.q && S.oyear === 'All';
    let html = '';
    if (grouped) {
      const act = list.filter((o) => OPEN.includes(o.status)).sort(SORTS.due);
      const rest = list.filter((o) => !OPEN.includes(o.status)).sort(SORTS.newest);
      html = (act.length ? `<div class="osec">Active · ${act.length}</div>${act.map(orow).join('')}` : '')
        + `<div class="osec">Past orders · ${rest.length}</div>${rest.map(orow).join('')}`;
    } else {
      list.sort(SORTS[S.sort] || SORTS.newest);
      html = list.map(orow).join('');
    }
    const live = list.filter((o) => o.status !== 'Declined');
    const tot = live.reduce((s, o) => s + num(o.amtDue), 0), paid = live.reduce((s, o) => s + num(o.paid), 0);
    $('#list').innerHTML = list.length
      ? `<div class="orow ohead"><span>Due</span><span>Customer</span><span>Cookies</span><span>Total</span><span>Paid</span><span>Balance</span><span>Status</span></div>${html}
         <div class="otot"><span>${plural(list.length, 'order')}</span><span>${plural(live.reduce((s, o) => s + num(o.qty), 0), 'cookie')}</span><span>${money(tot)} total</span><span>${money(paid)} paid</span><span>${money(live.filter(owes).reduce((a, o) => a + balance(o), 0))} owed</span></div>`
      : '<p style="padding:16px" class="muted">No orders match these filters.</p>';
  }

  function exportCsv() {
    const list = filtered().sort(SORTS[S.sort] || SORTS.newest);
    const cols = FIELDS.filter((f) => f[0][0] !== '#' && f[0][0] !== '@');
    const q = (v) => { let t = String(v ?? ''); if (/^[=@\t\r]|^[+-](?![\d. (])/.test(t)) t = "'" + t; return `"${t.replace(/"/g, '""')}"`; };
    const det = (o) => (o.payments || []).map((x) => `${x.date || '?'} ${money(x.amount)} ${x.method || ''} ${x.note || ''}`.trim()).join('; ');
    const csv = [[...cols.map((c) => q(c[1])), q('Payment details')].join(','), ...list.map((o) => [...cols.map((c) => q(o[c[0]])), q(det(o))].join(','))].join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `orders-${todayISO()}.csv`; a.click();
  }

  /* ---------- order editor ---------- */
  const OCCASIONS = [['Birthday', '🎂'], ['Graduation', '🎓'], ['Baby Shower', '🍼'], ['Bridal / Bachelorette', '💍'], ['Football / Sports', '🏈'],
    ['Thanksgiving', '🦃'], ['Christmas', '🎄'], ['Easter', '🐣'], ["Valentine's", '💝'], ['Halloween', '🎃'], ['Party / Event', '🎉'], ['Other', '✨']];
  const OCC_EMOJI = { ...Object.fromEntries(OCCASIONS), 'Not set': '❔' };
  const OCC_LEGACY = { football: 'Football / Sports', sports: 'Football / Sports', 'bachelorette party': 'Bridal / Bachelorette', bachelorette: 'Bridal / Bachelorette',
    'bridal shower': 'Bridal / Bachelorette', bridal: 'Bridal / Bachelorette', valentines: "Valentine's", valentine: "Valentine's", event: 'Party / Event', party: 'Party / Event',
    other: 'Other', 'baby shower': 'Baby Shower', birthday: 'Birthday', graduation: 'Graduation', thanksgiving: 'Thanksgiving', christmas: 'Christmas', easter: 'Easter', halloween: 'Halloween' };
  const OCC_RULES = [
    [/baby|gender|reveal/i, 'Baby Shower'], [/bridal|bachelorette|wedding|bride/i, 'Bridal / Bachelorette'],
    [/birthday|b-?day|\b\d+(st|nd|rd|th)\b/i, 'Birthday'], [/grad|diploma|class of/i, 'Graduation'],
    [/lions|football|msu|umich|michigan|tailgate|pistons|basketball|jersey|sports/i, 'Football / Sports'],
    [/thanksgiving|turkey|pie cookie/i, 'Thanksgiving'], [/christmas|xmas/i, 'Christmas'], [/easter|bunny/i, 'Easter'],
    [/valentine/i, "Valentine's"], [/halloween/i, 'Halloween'], [/retire|reunion|golf|bowling|luau|euchre|outing|party/i, 'Party / Event'],
  ];
  // Returns { name, source }: 'set' (your entry), 'guessed' (from the event text) or 'none'.
  function occasionOf(o) {
    const raw = (o.type || '').trim();
    const name = raw ? (OCC_LEGACY[raw.toLowerCase()] || raw) : '';
    if (name && name !== 'Party / Event' && name !== 'Other') return { name, source: 'set' };
    const text = [o.event, o.notes, o.colors].join(' ');
    const hit = OCC_RULES.find(([re]) => re.test(text));
    if (hit && hit[1] !== name) return { name: hit[1], source: 'guessed' };
    return name ? { name, source: 'set' } : { name: 'Not set', source: 'none' };
  }

  const METHODS = ['', 'Cash', 'Venmo', 'Zelle', 'Check', 'Gift', 'Other'];
  const FIELDS = [
    ['#', 'Customer & status'],
    ['name', 'Customer', 'text', { req: 1, list: 'customers' }], ['phone', 'Phone', 'tel'],
    ['email', 'Email', 'email'], ['social', 'Facebook or Instagram', 'text'],
    ['prefer', 'Best way to reach them', 'select', { opts: ['', 'Text', 'Call', 'Email', 'Facebook', 'Instagram'] }],
    ['@contact', '', 'contact'],
    ['contact', 'Other contact', 'text', { hide: 1 }],
    ['status', 'Status', 'select', { opts: STATUSES }], ['reason', 'Reason (if declined)', 'text'],
    ['#', 'Event & dates'],
    ['event', 'Event name / details', 'text'], ['type', 'Occasion', 'select', { opts: ['', ...OCCASIONS.map((x) => x[0])], hint: (o) => { const g = occasionOf(o); return !(o.type || '').trim() && g.source === 'guessed' ? `<small class="muted">Suggestion: ${esc(g.name)}</small>` : ''; } }],
    ['requested', 'Date requested', 'date'], ['due', 'Pickup or due date', 'date'],
    ['kind', 'Custom or premade', 'select', { opts: ['', 'Custom', 'Premade'] }], ['designs', '# of designs', 'number', { step: '1' }],
    ['#', 'Pricing'],
    ['qty', '# of cookies', 'number', { step: '1' }], ['price', 'Price each ($)', 'number', { step: '0.01' }],
    ['numColors', '# of colors', 'number', { step: '1' }], ['rush', 'Rush fee ($)', 'number', { step: '0.01' }],
    ['addOns', 'Add-ons', 'text'], ['addOnsAmt', 'Add-ons amount ($)', 'number', { step: '0.01' }],
    ['amtDue', 'Amount due ($)', 'number', { step: '0.01' }],
    ['#', 'Payment'],
    ['paid', 'Amount paid ($)', 'number', { step: '0.01', hide: 1 }], ['method', 'Payment method', 'select', { opts: METHODS, hide: 1 }],
    ['@pay', '', 'pay'],
    ['#', 'Details'],
    ['colors', 'Special colors', 'text'], ['allergies', 'Allergies', 'text'],
    ['notes', 'Notes', 'textarea', { wide: 1 }],
    ['#', 'Photos'],
    ['@photos', '', 'photos'],
  ];

  function calc(o) {
    const p = (S.site && S.site.pricing) || { perCookie: 4.35, cookiesPerBox: 18, bagPerCookie: .04, boxPrice: 1.5, ribbonPerBox: 1, tissuePerBox: .5, includedColors: 3, extraColorFee: 7 };
    const qty = num(o.qty), each = o.price == null ? p.perCookie : num(o.price);
    const boxes = Math.ceil(qty / p.cookiesPerBox);
    const extra = Math.max(0, (o.numColors == null ? p.includedColors : num(o.numColors)) - p.includedColors);
    const parts = [
      [`${qty} × ${money(each)}`, qty * each], ['Bags', qty * p.bagPerCookie],
      [`Boxes, ribbon, tissue (${boxes})`, boxes * (p.boxPrice + p.ribbonPerBox + p.tissuePerBox)],
      [`Extra colors (${extra})`, extra * p.extraColorFee], ['Rush', num(o.rush)], ['Add-ons', num(o.addOnsAmt)],
    ].filter((x) => x[1]);
    return { parts, total: Math.round(parts.reduce((s, x) => s + x[1], 0) * 100) / 100, p };
  }

  function openEdit(id, prefill) {
    const hadSplit = !!(id && byId(id).contact && !byId(id).phone && !byId(id).email && !byId(id).social);
    const o = splitContact(id ? { ...byId(id) } : { status: 'Requested', requested: todayISO(), ...(prefill || {}) });
    const types = [...new Set(S.vault.orders.map((x) => x.type).filter(Boolean))].sort();
    const dlg = $('#dlg');
    const fld = ([k, label, type, x = {}]) => {
      if (k === '#') return `<h3 class="fh">${label}</h3>`;
      if (x.hide) return '';
      if (k === '@contact') return '<div class="cacts wide" id="cacts"></div>';
      if (k === '@photos') return '<div class="ophotos wide" id="ophotos"></div>';
      if (k === '@pay') return '<div class="paybox wide" id="paybox"><div class="paysum" id="paysum"></div><div class="paylist" id="paylist"></div><div class="payact" id="payact"></div><div class="muted small" id="pay-msg" role="status"></div></div>';
      const v = o[k] ?? '';
      const cls = x.wide ? ' class="wide"' : '';
      if (type === 'select') {
        let cur = v;
        const hit = x.opts.find((s) => s && String(s).toLowerCase() === String(v).toLowerCase());
        if (hit) cur = hit;
        const opts = cur && !x.opts.includes(cur) ? [...x.opts, cur] : x.opts;
        return `<label${cls}>${label}<select name="${k}">${opts.map((s) => `<option value="${esc(s)}"${s === cur ? ' selected' : ''}>${s === '' ? '— select —' : esc(s)}</option>`).join('')}</select>${x.hint ? x.hint(o) : ''}</label>`;
      }
      if (type === 'textarea') return `<label${cls}>${label}<textarea name="${k}" rows="3">${esc(v)}</textarea></label>`;
      return `<label${cls}>${label}<input name="${k}" type="${type}" value="${esc(v)}"${x.step ? ` step="${x.step}"` : ''}${x.req ? ' required' : ''}${x.list ? ` list="dl-${x.list}"` : ''}></label>`;
    };
    dlg.innerHTML = `<form class="ef" id="ef" novalidate>
      <h2>${id ? 'Edit order' : 'New order'}</h2>
      <div class="fgrid">${FIELDS.map(fld).join('')}</div>
      <datalist id="dl-types">${types.map((t) => `<option>${esc(t)}</option>`).join('')}</datalist>
      <datalist id="dl-customers">${[...new Set(S.vault.orders.map((x) => x.name).filter(Boolean))].sort().map((n) => `<option>${esc(n)}</option>`).join('')}</datalist>
      <datalist id="dl-methods"><option>Cash</option><option>Venmo</option><option>Zelle</option><option>Check</option></datalist>
      <div class="actions">
        <button type="button" class="btn ghost small" id="b-calc">Calculate total</button>
        <button type="button" class="btn ghost small" id="b-rush">Add rush fee</button>
      </div>
      <div class="calc" id="calc"></div>
      <div class="actions">
        <button class="btn" type="submit">Save</button>
        <button class="btn ghost" type="button" id="b-cancel">Cancel</button>
        <span class="sp"></span>
        ${id ? '<button class="btn danger" type="button" id="b-del">Delete</button>' : ''}
      </div></form>`;
    const ef = $('#ef');
    const read = () => {
      const out = {};
      for (const [k, , type, x = {}] of FIELDS) {
        if (k[0] === '#' || k[0] === '@' || x.hide) continue;
        const v = ef.elements[k].value;
        out[k] = type === 'number' ? (v === '' ? null : +v) : v.trim();
      }
      return out;
    };
    const showCalc = () => {
      const c = calc(read());
      $('#calc').innerHTML = c.parts.map(([l, a]) => `${esc(l)}: ${money(a)}`).join(' · ') + `<br><b>Total ${money(c.total)}</b>`;
      return c;
    };
    $('#b-calc').onclick = () => { const c = showCalc(); ef.elements.amtDue.value = c.total; drawSum(); };
    $('#b-rush').onclick = () => {
      const p = calc(read()).p;
      ef.elements.rush.value = Math.ceil(num(ef.elements.qty.value) / 12) * (p.rushPerDozen ?? 5);
      showCalc();
    };
    // ----- contact: quick actions + fill from this customer's earlier orders -----
    const drawContact = () => {
      const ph = ef.elements.phone.value.trim(), em = ef.elements.email.value.trim();
      $('#cacts').innerHTML = ph || em ? `${ph ? `<a class="btn ghost small" href="${esc(telHref(ph))}">${ico('phone')} Call</a><a class="btn ghost small" href="${esc(smsHref(ph))}">${ico('chat')} Text</a>` : ''}${em ? `<a class="btn ghost small" href="mailto:${esc(em)}">${ico('mail')} Email</a>` : ''}<span class="muted small" id="cfill"></span>`
        : '<span class="muted small" id="cfill">Add a phone number or email to call, text or email from here.</span>';
    };
    const sameCustomer = (name) => S.vault.orders.filter((x) => x.id !== id && x.name && x.name.trim().toLowerCase() === name.trim().toLowerCase());
    const fillFromPast = () => {
      const name = ef.elements.name.value;
      if (!name.trim() || ef.elements.phone.value || ef.elements.email.value || ef.elements.social.value) return;
      const past = sameCustomer(name).map((x) => splitContact({ ...x })).filter((x) => x.phone || x.email || x.social).sort(newestFirst)[0];
      if (!past) return;
      ['phone', 'email', 'social', 'prefer'].forEach((f) => { if (past[f]) ef.elements[f].value = past[f]; });
      drawContact();
      $('#cfill').textContent = `Filled in from ${past.name}'s order on ${fmtDate(past.due || past.requested) || 'an earlier date'}.`;
    };
    drawContact();
    if (!id) fillFromPast();
    ef.elements.name.addEventListener('change', fillFromPast);
    ef.addEventListener('input', (e) => { if (e.target.name === 'phone' || e.target.name === 'email') drawContact(); });

    // ----- payments ledger (split payments) -----
    const r2 = (n) => Math.round(n * 100) / 100;
    let pays = (o.payments || []).map((x) => ({ ...x }));
    if (!pays.length && num(o.paid) > 0) pays = [{ date: '', amount: num(o.paid), method: o.method || '', note: 'Earlier total' }];
    let payTouched = false;
    const paidSum = () => r2(pays.reduce((t, x) => t + num(x.amount), 0));
    const mOpts = (cur) => {
      const hit = METHODS.find((m) => m && m.toLowerCase() === String(cur || '').toLowerCase());
      const c = hit || cur || '';
      return (c && !METHODS.includes(c) ? [...METHODS, c] : METHODS).map((m) => `<option value="${esc(m)}"${m === c ? ' selected' : ''}>${m === '' ? 'Method' : esc(m)}</option>`).join('');
    };
    const applyPays = (ord) => {
      ord.payments = pays.map((x) => ({ date: x.date || '', amount: num(x.amount), method: x.method || '', note: (x.note || '').trim() })).filter((x) => x.amount || x.note);
      ord.paid = ord.payments.length ? paidSum() : null;
      const ms = [...new Set(ord.payments.map((x) => x.method).filter(Boolean))];
      ord.method = ms.length > 1 ? 'Multiple' : ms[0] || '';
    };
    const persist = () => { payTouched = true; if (id) { applyPays(byId(id)); touch(); } };
    const drawRows = () => {
      $('#paylist').innerHTML = pays.length ? pays.map((x, i) => `<div class="payrow" data-pi="${i}">
        <input type="date" data-pf="date" value="${esc(x.date)}" aria-label="Payment date">
        <input type="number" step="0.01" min="0" data-pf="amount" value="${x.amount ?? ''}" placeholder="Amount" aria-label="Amount">
        <select data-pf="method" aria-label="Payment method">${mOpts(x.method)}</select>
        <input data-pf="note" value="${esc(x.note)}" placeholder="Note (for example, deposit)" aria-label="Note">
        <button type="button" class="icon-x" data-pdel="${i}" aria-label="Remove payment">×</button></div>`).join('') : '<p class="muted small" style="margin:0">No payments yet.</p>';
    };
    const drawSum = () => {
      const due = num(ef.elements.amtDue.value), paid = paidSum(), bal = r2(due - paid), full = due > 0 && bal <= 0.005;
      $('#paysum').innerHTML = `<span>Due <b>${money(due)}</b></span><span>Paid <b>${money(paid)}</b>${pays.length > 1 ? ` <span class="muted small">(${pays.length} payments)</span>` : ''}</span>
        <span>Balance <b class="${full ? 'ok' : bal > 0 ? 'neg' : ''}">${full ? '✓ none' : bal < 0 ? 'Overpaid ' + money(-bal) : money(bal)}</b></span>`;
      $('#payact').innerHTML = `${full ? '<span class="pill paidfull">✓ Paid in full</span>' : due > 0 && bal > 0 ? `<button type="button" class="btn" data-pfull>Paid in full · ${money(bal)}</button>` : ''}
        ${!pays.length && due > 0 ? `<button type="button" class="btn ghost" data-pdep>Deposit 50% · ${money(due / 2)}</button>` : ''}
        <button type="button" class="btn ghost" data-padd>+ Add payment</button>`;
    };
    const lastMethod = () => [...pays].reverse().find((x) => x.method)?.method || '';
    const addPay = (amount, note) => {
      pays.push({ date: todayISO(), amount: r2(amount), method: lastMethod(), note: note || '' });
      persist(); drawRows(); drawSum(); render();
      const last = $('#paylist').querySelector('.payrow:last-child [data-pf=method]'); if (last && !last.value) last.focus();
    };
    drawRows(); drawSum();
    ef.addEventListener('input', (e) => {
      if (e.target.name === 'amtDue') drawSum();
      const row = e.target.closest('.payrow');
      if (row && e.target.dataset.pf) { pays[+row.dataset.pi][e.target.dataset.pf] = e.target.value; persist(); drawSum(); }
    });
    ef.addEventListener('change', (e) => { if (e.target.closest('.payrow')) render(); });
    $('#paybox').addEventListener('click', (e) => {
      const t = e.target, due = num(ef.elements.amtDue.value), bal = r2(due - paidSum());
      $('#pay-msg').textContent = '';
      if (t.closest('[data-pfull]')) { if (bal > 0) addPay(bal, ''); return; }
      if (t.closest('[data-pdep]')) { addPay(due / 2, 'Deposit'); return; }
      if (t.closest('[data-padd]')) { if (!due) $('#pay-msg').textContent = 'Tip: enter the amount due first so the balance is right.'; addPay(Math.max(bal, 0), ''); return; }
      const del = t.closest('[data-pdel]');
      if (del) { pays.splice(+del.dataset.pdel, 1); persist(); drawRows(); drawSum(); render(); }
    });
    // ----- photos on this order -----
    const drawOrderPhotos = () => {
      const box = $('#ophotos'); if (!box) return;
      if (!id) { box.innerHTML = '<p class="muted small" style="margin:0">Save the order first, then you can add photos to it.</p>'; return; }
      const mine = photos().filter((x) => x.orderId === id);
      box.dataset.oid = id; box._refresh = drawOrderPhotos;
      box.innerHTML = `${mine.length ? `<div class="pgrid small">${mine.map((x) => `<button type="button" class="ptile" data-pid="${x.id}" aria-label="Open photo"></button>`).join('')}</div>` : '<p class="muted small" style="margin:0 0 8px">No photos yet.</p>'}
        <button type="button" class="btn ghost small" data-oadd>+ Add photos</button> <span class="muted small drop-hint">or drag pictures here</span>${tok() ? '' : ' <span class="muted small">Add your GitHub token in Settings first.</span>'}`;
      lazyThumbs(box);
    };
    drawOrderPhotos();
    $('#ophotos').addEventListener('click', (e) => {
      if (e.target.closest('[data-oadd]')) { pickPhotos({ orderId: id }, drawOrderPhotos); return; }
      const t = e.target.closest('[data-pid]');
      if (t) { const ids = photos().filter((x) => x.orderId === id).map((x) => x.id); openViewer(ids, ids.indexOf(t.dataset.pid), drawOrderPhotos); }
    });
    let snap = null;
    const askClose = () => { if (snap === null || JSON.stringify(read()) === snap || confirm('Discard your changes to this order?')) dlg.close(); };
    $('#b-cancel').onclick = askClose;
    dlg.oncancel = (e) => { e.preventDefault(); askClose(); };
    dlg.addEventListener('close', () => { dlg.oncancel = null; }, { once: true });
    if (id) $('#b-del').onclick = () => {
      const idx = S.vault.orders.findIndex((x) => x.id === id), removed = S.vault.orders[idx];
      const linked = photos().filter((ph) => ph.orderId === id);
      S.vault.orders.splice(idx, 1); linked.forEach((ph) => (ph.orderId = null));
      dlg.close(); touch(); render();
      toast(`Deleted the order for ${removed.name}`, { action: 'Undo', onAction: () => { S.vault.orders.splice(idx, 0, removed); linked.forEach((ph) => (ph.orderId = id)); touch(); render(); } });
    };
    ef.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!ef.elements.name.value.trim()) { ef.elements.name.focus(); return; }
      const data = read();
      for (const [f, fn] of Object.entries(TEXT_FIELDS)) if (typeof data[f] === 'string') data[f] = fn(data[f]);
      let ord;
      if (id) { ord = byId(id); Object.assign(ord, data); if (hadSplit) ord.contact = ''; }
      else { ord = { id: crypto.randomUUID().slice(0, 8), ...data }; S.vault.orders.push(ord); }
      if (payTouched || !id) applyPays(ord);
      dlg.close(); touch(); render();
      const others = (ord.phone || ord.email || ord.social) ? S.vault.orders.filter((x) => x !== ord && x.name && x.name.trim().toLowerCase() === ord.name.trim().toLowerCase() && !x.phone && !x.email && !x.social) : [];
      if (others.length) toast(`Add this contact info to ${plural(others.length, 'other order')} for ${ord.name}?`, { action: 'Add', onAction: () => {
        others.forEach((x) => { splitContact(x); ['phone', 'email', 'social', 'prefer'].forEach((f) => { if (ord[f] && !x[f]) x[f] = ord[f]; }); });
        touch(); render(); toast(`Contact info added to ${plural(others.length, 'order')}.`);
      } });
    });
    snap = JSON.stringify(read());
    dlg.showModal();
  }

  /* ---------- home dashboard ---------- */
  function viewHome(main) {
    const orders = S.vault.orders, now = new Date(), today = todayISO();
    const active = orders.filter((o) => OPEN.includes(o.status));
    const byDue = (a, b) => a.due.localeCompare(b.due);
    const upcoming = active.filter((o) => o.due && o.due >= today).sort(byDue);
    const overdue = active.filter((o) => o.due && o.due < today).sort(byDue);
    const undated = active.filter((o) => !o.due);
    const weekEnd = isoDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7));
    const week = upcoming.filter((o) => o.due <= weekEnd);
    const cash = cashByMonth();
    const sumPaid = (pre) => cashSum(cash, pre);
    const owed = orders.filter(owes).sort((a, b) => balance(b) - balance(a));
    const hr = now.getHours();
    const greet = hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
    const months = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1);
      return { l: d.toLocaleDateString(undefined, { month: 'short' }), v: sumPaid(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`) };
    });
    const attention = [...overdue, ...undated];
    const ins = insights();
    const monShort = (iso) => new Date(iso + 'T00:00').toLocaleDateString(undefined, { month: 'short' });
    const cuRow = (o) => `<div class="cu st-${o.status}" data-id="${o.id}"><span class="datebadge"><small>${monShort(o.due)}</small><b>${+o.due.slice(8, 10)}</b></span>
      <span class="cu-main"><b>${esc(o.name)}</b><small>${esc(o.event || o.type || '')}${o.event || o.type ? ' · ' : ''}${cookiesOf(o.qty)}${esc(relDue(o.due, today))}</small></span>
      <span class="cu-end">${o.phone ? `<a class="cu-call" href="${esc(telHref(o.phone))}" aria-label="Call ${esc(o.name)}" title="Call ${esc(o.phone)}">${ico('phone')}</a>` : ''}<span class="pill st-${o.status}">${o.status}</span>${balance(o) > 0.005 && o.amtDue != null ? `<span class="neg small">${money(balance(o))} due</span>` : ''}</span></div>`;
    const strip = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i), iso = isoDate(d), n = upcoming.filter((o) => o.due === iso).length;
      return `<button class="dchip${n ? ' has' : ''}${i === 0 ? ' today' : ''}" data-calday="${iso}"><span class="dw">${i === 0 ? 'Today' : d.toLocaleDateString(undefined, { weekday: 'short' })}</span><span class="dn">${d.getDate()}</span><span class="dc">${n ? plural(n, 'order') : '—'}</span></button>`;
    }).join('');
    const recent = [...photos()].sort((a, b) => (b.added || '').localeCompare(a.added || '') || (b.date || '').localeCompare(a.date || '')).slice(0, 6);
    main.innerHTML = `<section class="hero-card">
        <div><p class="eyebrow">${now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</p><h2>${greet}</h2>
          <p>${week.length ? `<b>${week.length}</b> pickup${week.length === 1 ? '' : 's'} in the next 7 days · <b>${week.reduce((s, o) => s + num(o.qty), 0)}</b> ${week.reduce((s, o) => s + num(o.qty), 0) === 1 ? 'cookie' : 'cookies'} to bake` : 'Nothing due in the next 7 days.'}</p></div>
        <div class="qa"><button class="btn" data-new>+ New order</button><button class="btn ghost" data-tab="calculator">Calculator</button><button class="btn ghost" data-tab="calendar">Calendar</button></div>
      </section>
      <div class="daystrip" aria-label="Next 7 days">${strip}</div>
      <div class="kpis">
        <div class="kpi"><span class="kic">${ico('orders')}</span><b>${active.length}</b><span>Active orders</span></div>
        <div class="kpi"><span class="kic">${ico('money')}</span><b class="${owed.length ? 'neg' : ''}">${money(owed.reduce((s, o) => s + balance(o), 0))}</b><span>Owed to you (${owed.length})</span></div>
        <div class="kpi"><span class="kic">${ico('cal')}</span><b>${money(sumPaid(today.slice(0, 7)))}</b><span>Collected in ${now.toLocaleDateString(undefined, { month: 'long' })}</span></div>
        <div class="kpi"><span class="kic">${ico('trend')}</span><b>${money(sumPaid(today.slice(0, 4)))}</b><span>Collected in ${now.getFullYear()}</span></div>
      </div>
      <div class="home-grid">
        <div class="home-main">
          <div class="panel"><h3>Coming up</h3>
            ${upcoming.length ? upcoming.slice(0, 6).map(cuRow).join('') : '<p class="muted">No upcoming pickups. Add an order to get started.</p>'}
            ${upcoming.length > 6 ? '<button class="btn ghost small" data-tab="calendar">See all in calendar</button>' : ''}</div>
          <div class="panel"><div class="mhead"><h3>Collected, last 6 months</h3><button class="btn ghost small" data-tab="money">Money details</button></div>${bars(months)}</div>
          <div class="panel"><h3>Your busiest months</h3><p class="muted small" style="margin:-4px 0 10px">Completed orders by month, all years together. Plan ahead for the tall ones.</p>${bars(ins.byMon.map((v, i) => ({ l: monthName(i, 'short'), v })), (v) => String(v))}</div>
        </div>
        <aside class="home-rail">
          <div class="panel"><h3>Needs attention</h3>
            ${attention.length ? `<div class="sub">Overdue or no date</div>${attention.slice(0, 5).map(evRow).join('')}` : ''}
            ${owed.length ? `<div class="sub">Balances owed</div>${owed.slice(0, 5).map(evRow).join('')}` : ''}
            ${!attention.length && !owed.length ? '<p class="muted">All caught up. 🎉</p>' : ''}</div>
          <div class="panel"><div class="mhead"><h3>Top customers</h3><button class="btn ghost small" data-tab="customers">All customers</button></div>
            ${ins.top.slice(0, 5).map((c, i) => `<button type="button" class="topc" data-cust="${esc(c.key)}"><span class="rank">${i + 1}</span>${avatar(c.name)}<span class="tc-name"><b>${esc(c.name)}</b><small>${plural(c.count, 'order')}</small></span><span class="tc-spent">${money(c.spent)}</span></button>`).join('') || '<p class="muted">No customers yet.</p>'}</div>
          <div class="panel"><h3>Quick facts</h3>
            <ul class="facts">
              <li><b>${Math.round(ins.repeatPct * 100)}%</b> of customers ordered more than once</li>
              ${ins.leadMedian !== null ? `<li>People usually order <b>${plural(ins.leadMedian, 'day')}</b> before pickup</li>` : ''}
              <li><b>${monthName(ins.busiest)}</b> is your busiest month</li>
              <li><b>${Math.round(ins.conv * 100)}%</b> of inquiries became orders</li>
            </ul><button class="btn ghost small" data-tab="money">See all insights</button></div>
          ${recent.length ? `<div class="panel"><div class="mhead"><h3>Recent photos</h3><button class="btn ghost small" data-tab="photos">See all</button></div>
            <div class="pgrid small" id="homephotos">${recent.map((x) => `<button class="ptile" data-pid="${x.id}" aria-label="${esc(x.caption || 'Photo')}"></button>`).join('')}</div></div>` : ''}
        </aside>
      </div>`;
    const hp = $('#homephotos');
    if (hp) { lazyThumbs(hp); hp.onclick = (e) => { const t = e.target.closest('[data-pid]'); if (t) { const ids = recent.map((x) => x.id); openViewer(ids, ids.indexOf(t.dataset.pid)); } }; }
  }

  function viewMore(main) {
    const card = (tab, icon, title, text) => `<button class="linkcard" data-tab="${tab}"><span class="emo">${icon}</span><b>${title}</b><span class="muted">${text}</span></button>`;
    main.innerHTML = `<h2>More</h2><div class="linkcards">
      ${card('customers', ico('users'), 'Customers', 'Everyone who has ordered, with history and contact info')}
      ${card('photos', ico('photo'), 'Photos', 'Your cookie photos and inspiration')}
      ${card('calculator', ico('calc'), 'Price calculator', 'Quote a set of cookies')}
      ${card('workbook', ico('book'), 'Workbook', 'Recipe and cost sheets')}
      ${card('settings', ico('gear'), 'Settings', 'Saving, password, import, backup')}
      <button class="linkcard" id="lock-more"><span class="emo">${ico('lock')}</span><b>Lock</b><span class="muted">Sign out on this device</span></button></div>`;
  }

  /* ---------- calendar ---------- */
  const short = (n) => { const w = String(n).trim().split(/\s+/); return w.length > 1 ? `${w[0]} ${w[w.length - 1][0]}.` : w[0]; };
  function evRow(o) {
    return `<div class="ev st-${o.status}" data-id="${o.id}">
      <span class="who">${esc(o.name)}</span><span>${esc(o.event || o.type || '')}</span>
      <span>${cookiesOf(o.qty)}</span>${num(o.rush) > 0 ? '<span class="pill rush">Rush</span>' : ''}
      <span class="pill st-${o.status}">${o.status}</span>
      ${balance(o) > 0.005 && o.amtDue != null ? `<span class="neg">${money(balance(o))} due</span>` : ''}</div>`;
  }
  function viewCalendar(main) {
    const now = new Date(), today = todayISO();
    const c = S.cal || (S.cal = { y: now.getFullYear(), m: now.getMonth() });
    const showDone = S.calDone !== false;
    const first = new Date(c.y, c.m, 1), days = new Date(c.y, c.m + 1, 0).getDate(), lead = first.getDay();
    const rows = Math.ceil((lead + days) / 7), mk = `${c.y}-${pad(c.m + 1)}`;
    const key = (d) => `${mk}-${pad(d)}`;
    const dataYears = S.vault.orders.map((o) => +(o.due || o.requested || '').slice(0, 4)).filter(Boolean);
    const yMin = Math.min(c.y, now.getFullYear(), ...dataYears), yMax = Math.max(c.y, now.getFullYear() + 1, ...dataYears);
    const yearOpts = Array.from({ length: yMax - yMin + 1 }, (_, i) => yMax - i);
    const list = S.vault.orders.filter((o) => o.due && o.due.startsWith(mk) && o.status !== 'Declined' && (showDone || o.status !== 'Completed'));
    const byDay = {};
    list.forEach((o) => (byDay[o.due] ||= []).push(o));
    if (!S.calDay || !S.calDay.startsWith(mk)) S.calDay = today.startsWith(mk) ? today : key(1);

    let cells = '';
    for (let i = 0; i < rows * 7; i++) {
      const d = i - lead + 1;
      if (d < 1 || d > days) { cells += '<div class="cd out"></div>'; continue; }
      const date = key(d), ev = byDay[date] || [];
      cells += `<div class="cd${date === today ? ' today' : ''}${date === S.calDay ? ' sel' : ''}" data-day="${date}">
        <div class="dn"><span>${d}</span><button class="add" data-newdate="${date}" aria-label="New order on ${date}" title="New order">+</button></div>
        ${ev.slice(0, 3).map((o) => `<button class="cev st-${o.status}" data-id="${o.id}" title="${esc(o.name)} — ${cookiesOf(o.qty)}">${num(o.rush) > 0 ? '⚡' : ''}${esc(short(o.name))} <b>${o.qty ?? ''}</b></button>`).join('')}
        ${ev.length > 3 ? `<span class="more">+${ev.length - 3} more</span>` : ''}</div>`;
    }
    const sel = (byDay[S.calDay] || []);
    const open = S.vault.orders.filter((o) => OPEN.includes(o.status));
    const attention = open.filter((o) => !o.due || o.due < today).sort((a, b) => (a.due || '').localeCompare(b.due || ''));
    const cookies = list.reduce((s, o) => s + num(o.qty), 0), quoted = list.reduce((s, o) => s + num(o.amtDue), 0);

    main.innerHTML = `<div class="cal-head">
        <button class="btn ghost small" data-cal="prev" aria-label="Previous month">‹</button>
        <div class="cal-pick">
          <select id="cal-month" aria-label="Month">${Array.from({ length: 12 }, (_, i) => `<option value="${i}"${i === c.m ? ' selected' : ''}>${new Date(2000, i, 1).toLocaleDateString(undefined, { month: 'long' })}</option>`).join('')}</select>
          <select id="cal-year" aria-label="Year">${yearOpts.map((y) => `<option${y === c.y ? ' selected' : ''}>${y}</option>`).join('')}</select>
        </div>
        <button class="btn ghost small" data-cal="next" aria-label="Next month">›</button>
        <button class="btn ghost small" data-cal="today">Today</button>
        <span class="sp"></span>
        <label class="check"><input type="checkbox" id="cal-done"${showDone ? ' checked' : ''}> Show completed</label>
        <button class="btn small" data-new>+ New order</button>
      </div>
      <p class="muted small">${plural(list.length, 'order')} · ${plural(cookies, 'cookie')} · ${money(quoted)} quoted this month</p>
      <div class="legend">${['Requested', 'Confirmed', 'Baking', 'Ready', 'Completed'].map((s) => `<span class="pill st-${s}">${s}</span>`).join('')} <span class="pill rush">⚡ Rush</span></div>
      <div class="cal" role="grid" aria-label="Orders by due date">
        ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((w) => `<div class="wd">${w}</div>`).join('')}${cells}</div>
      <div class="day">${esc(fmtDate(S.calDay))}${S.calDay === today ? ' · Today' : ''}
        <button class="btn ghost small" data-newdate="${S.calDay}" style="margin-left:8px">+ Add order this day</button></div>
      ${sel.length ? sel.map(evRow).join('') : '<p class="muted small">Nothing due this day.</p>'}
      ${attention.length ? `<div class="day over">Needs attention — overdue or no date</div>${attention.map(evRow).join('')}` : ''}`;
  }

  /* ---------- money ---------- */
  // Cash basis: every payment on a live (not declined/cancelled) order, counted on the date it was received. Payments without a date
  // (e.g. imported totals) fall back to the order's pickup date, then its request date.
  function paymentsOf(o) {
    const fb = o.due || o.requested || '';
    if ((o.payments || []).length) return o.payments.map((p) => ({ date: p.date || fb, amount: num(p.amount) }));
    return num(o.paid) > 0 ? [{ date: fb, amount: num(o.paid) }] : [];
  }
  function cashByMonth() {
    const m = {};
    for (const o of S.vault.orders) for (const p of o.status === 'Declined' ? [] : paymentsOf(o)) { const k = (p.date || '').slice(0, 7); if (k.length === 7) m[k] = (m[k] || 0) + p.amount; }
    return m;
  }
  const cashSum = (map, prefix) => Object.entries(map).reduce((t, [k, v]) => (k.startsWith(prefix) ? t + v : t), 0);

  function yearStats() {
    const years = {};
    const Y = (y) => (years[y] ||= { y, orders: 0, cookies: 0, rev: 0, cash: 0, declined: 0 });
    for (const o of S.vault.orders) {
      if (o.status === 'Completed') {
        const y = (o.due || o.requested || '').slice(0, 4);
        if (y) { const r = Y(y); r.orders++; r.cookies += num(o.qty); r.rev += num(o.paid); }
      } else if (o.status === 'Declined') {
        const y = (o.requested || '').slice(0, 4);
        if (y) Y(y).declined++;
      }
    }
    for (const [k, v] of Object.entries(cashByMonth())) Y(k.slice(0, 4)).cash += v;
    return Object.values(years).sort((a, b) => a.y - b.y);
  }
  function bars(items, fmt = (v) => '$' + Math.round(v).toLocaleString()) {
    const max = Math.max(1, ...items.map((i) => i.v));
    return `<div class="vbars" role="img" aria-label="Bar chart">${items.map((it) => `<div class="vb" title="${esc(it.l)}: ${esc(fmt(it.v))}">
      <span class="vb-v">${it.v ? esc(fmt(it.v)) : ''}</span><i style="height:${Math.max(it.v ? 3 : 0, it.v / max * 100).toFixed(1)}%"></i><span class="vb-l">${esc(it.l)}</span></div>`).join('')}</div>`;
  }
  /* ---------- customers ---------- */
  const custKey = (n) => String(n || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const initials = (n) => String(n || '?').replace(/\(.*?\)/g, '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
  const hueOf = (n) => { let h = 0; for (const ch of custKey(n)) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; };
  const avatar = (n, cls = '') => `<span class="avatar ${cls}" style="--hue:${hueOf(n)}" aria-hidden="true">${esc(initials(n))}</span>`;
  function customers() {
    const map = new Map();
    for (const o of S.vault.orders) {
      const k = custKey(o.name); if (!k) continue;
      let c = map.get(k);
      if (!c) map.set(k, (c = { key: k, name: o.name, orders: [], declined: 0 }));
      if (o.status === 'Declined') c.declined++; else c.orders.push(o);
    }
    const out = [];
    for (const c of map.values()) {
      if (!c.orders.length) continue;
      const os = c.orders.sort(newestFirst), latest = os[0], oldest = os[os.length - 1];
      c.name = latest.name; c.count = os.length; c.done = os.filter((o) => o.status === 'Completed').length;
      c.spent = os.reduce((t, o) => t + num(o.paid), 0);
      c.owed = os.filter(owes).reduce((t, o) => t + balance(o), 0);
      c.cookies = os.reduce((t, o) => t + num(o.qty), 0);
      c.last = latest.due || latest.requested || ''; c.first = oldest.due || oldest.requested || '';
      const occ = {}; os.forEach((o) => { const n = occasionOf(o).name; if (n !== 'Not set') occ[n] = (occ[n] || 0) + 1; });
      c.occ = Object.entries(occ).sort((a, b) => b[1] - a[1]);
      const wc = os.map((o) => splitContact({ ...o })).find((o) => o.phone || o.email || o.social) || {};
      c.phone = wc.phone || ''; c.email = wc.email || ''; c.social = wc.social || ''; c.prefer = wc.prefer || '';
      out.push(c);
    }
    return out;
  }

  function insights() {
    const orders = S.vault.orders, done = orders.filter((o) => o.status === 'Completed'), declined = orders.filter((o) => o.status === 'Declined');
    const cs = customers(), repeat = cs.filter((c) => c.done > 1);
    const leads = done.map((o) => (o.requested && o.due ? Math.round((new Date(o.due) - new Date(o.requested)) / 864e5) : null)).filter((d) => d !== null && d >= 0 && d < 400).sort((a, b) => a - b);
    const byMon = Array(12).fill(0); done.forEach((o) => { const d = o.due || o.requested; if (d) byMon[+d.slice(5, 7) - 1]++; });
    const reasons = {}; declined.forEach((o) => { const r = o.reason ? o.reason.charAt(0).toUpperCase() + o.reason.slice(1).toLowerCase() : 'No reason given'; reasons[r] = (reasons[r] || 0) + 1; });
    const top = cs.slice().sort((a, b) => b.spent - a.spent);
    return {
      customers: cs.length, repeat: repeat.length, repeatPct: cs.length ? repeat.length / cs.length : 0,
      repeatShare: done.length ? done.filter((o) => repeat.some((c) => c.key === custKey(o.name))).reduce((t, o) => t + num(o.paid), 0) / Math.max(1, done.reduce((t, o) => t + num(o.paid), 0)) : 0,
      leadMedian: leads.length ? leads[Math.floor(leads.length / 2)] : null, leadShort: leads.length ? leads.filter((d) => d < 7).length / leads.length : 0,
      byMon, busiest: byMon.indexOf(Math.max(...byMon)),
      reasons: Object.entries(reasons).sort((a, b) => b[1] - a[1]),
      busy: declined.filter((o) => /busy|rush/i.test(o.reason || '')).length,
      conv: done.length + declined.length ? done.length / (done.length + declined.length) : 0,
      avgOrder: done.length ? done.reduce((t, o) => t + num(o.paid), 0) / done.length : 0,
      top,
    };
  }
  const monthName = (i, style = 'long') => new Date(2000, i, 1).toLocaleDateString(undefined, { month: style });

  function viewCustomers(main) {
    const all = customers(), ins = insights();
    const chip = (k, l, c) => `<button class="chip" data-cf="${k}" aria-selected="${(S.cf || 'all') === k}">${l} (${c})</button>`;
    const top = ins.top[0];
    main.innerHTML = `${pageHead('Customers', `${plural(all.length, 'customer')} · ${ins.repeat} came back for more`, '<button class="btn small" data-new>+ New order</button>')}
      <div class="kpis">
        <div class="kpi"><span class="kic">${ico('users')}</span><b>${all.length}</b><span>Customers</span></div>
        <div class="kpi"><span class="kic">${ico('repeat')}</span><b>${Math.round(ins.repeatPct * 100)}%</b><span>Ordered more than once</span></div>
        <div class="kpi"><span class="kic">${ico('money')}</span><b>${money(all.length ? all.reduce((t, c) => t + c.spent, 0) / all.length : 0)}</b><span>Average spent per customer</span></div>
        <div class="kpi"><span class="kic">${ico('trend')}</span><b style="font-size:1.15rem">${top ? esc(top.name) : '—'}</b><span>${top ? 'Top customer · ' + money(top.spent) : 'Top customer'}</span></div>
      </div>
      ${(() => { const n = dupePairs().length; return n ? `<div class="notice dupe-note">${ico('users')}<span><b>${plural(n, 'possible duplicate')}</b> found, such as the same person under two spellings. Nothing has been changed.</span><button class="btn small" data-dupes>Review</button></div>` : ''; })()}
      <div class="bar"><input class="grow" id="cq" type="search" placeholder="Search customers, phone, email…" value="${esc(S.cq || '')}"></div>
      <div class="bar">${chip('all', 'All', all.length)}${chip('repeat', 'Repeat', all.filter((c) => c.count > 1).length)}${chip('owes', 'Owes money', all.filter((c) => c.owed > 0.005).length)}${chip('nocontact', 'No contact info', all.filter((c) => !c.phone && !c.email && !c.social).length)}
        <span class="sp"></span><select id="csort" aria-label="Sort">${[['spent', 'Top spenders'], ['orders', 'Most orders'], ['recent', 'Most recent'], ['name', 'Name A–Z']].map(([v, l]) => `<option value="${v}"${(S.csort || 'spent') === v ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
      <div id="clist" class="clist"></div>`;
    drawCustomers();
  }
  function drawCustomers() {
    const el = $('#clist'); if (!el) return;
    const q = (S.cq || '').toLowerCase(), f = S.cf || 'all';
    const sorts = { spent: (a, b) => b.spent - a.spent, orders: (a, b) => b.count - a.count || b.spent - a.spent, recent: (a, b) => b.last.localeCompare(a.last), name: (a, b) => a.name.localeCompare(b.name) };
    const list = customers().filter((c) => (f === 'all' || (f === 'repeat' && c.count > 1) || (f === 'owes' && c.owed > 0.005) || (f === 'nocontact' && !c.phone && !c.email && !c.social))
      && (!q || [c.name, c.phone, c.email, c.social].join(' ').toLowerCase().includes(q))).sort(sorts[S.csort || 'spent']);
    el.innerHTML = list.length ? `<div class="crow chead"><span></span><span>Customer</span><span>Orders</span><span>Spent</span><span>Last order</span><span>Usually orders for</span><span>Balance</span></div>
      ${list.map((c) => `<div class="crow" data-cust="${esc(c.key)}" role="button" tabindex="0" aria-label="${esc(c.name)}">${avatar(c.name)}
        <span class="cr-name"><b>${esc(c.name)}</b><small>${c.phone ? `<a href="${esc(telHref(c.phone))}">${esc(c.phone)}</a>` : c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : esc(c.social) || '<span class="muted">No contact info</span>'}</small></span>
        <span class="cr-n">${plural(c.count, 'order')}</span><span class="cr-spent">${money(c.spent)}</span>
        <span class="cr-last">${esc(fmtDate(c.last)) || '—'}</span>
        <span class="cr-occ">${c.occ.length ? `${OCC_EMOJI[c.occ[0][0]] || ''} ${esc(c.occ[0][0])}` : '<span class="muted">—</span>'}</span>
        <span class="cr-owe ${c.owed > 0.005 ? 'neg' : 'muted'}">${c.owed > 0.005 ? money(c.owed) + ' due' : '✓'}</span></div>`).join('')}`
      : '<p style="padding:18px" class="muted">No customers match.</p>';
  }

  /* ---------- duplicate customers (suggested, never merged automatically) ---------- */
  const nameNorm = (n) => String(n || '').toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
  function lev(a, b) {
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      for (let j = 1; j <= b.length; j++) cur.push(Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] !== b[j - 1])));
      prev = cur;
    }
    return prev[b.length];
  }
  const pairKey = (a, b) => [a, b].sort().join('|');
  function people() {   // every distinct name, including people whose only requests were declined
    const map = new Map();
    for (const o of S.vault.orders) {
      const k = custKey(o.name); if (!k) continue;
      let p = map.get(k);
      if (!p) map.set(k, (p = { key: k, name: o.name, orders: [], spent: 0, last: '', phone: '', email: '' }));
      p.orders.push(o);
      if (o.status !== 'Declined') p.spent += num(o.paid);
      const d = o.due || o.requested || ''; if (d > p.last) { p.last = d; p.name = o.name; }
      const c = splitContact({ ...o }); if (!p.phone && c.phone) p.phone = c.phone; if (!p.email && c.email) p.email = c.email;
    }
    return [...map.values()];
  }
  function dupePairs() {
    const ps = people(), skip = new Set(S.vault.notDupes || []), out = [];
    for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
      const A = ps[i], B = ps[j];
      if (skip.has(pairKey(A.key, B.key))) continue;
      const na = nameNorm(A.name), nb = nameNorm(B.name); if (!na || !nb) continue;
      const ta = na.split(' '), tb = nb.split(' ');
      const digits = (x) => x.replace(/\D/g, '');
      let why = '';
      if ((A.phone && digits(A.phone) === digits(B.phone)) || (A.email && A.email.toLowerCase() === (B.email || '').toLowerCase())) why = 'Same phone or email';
      else if (na === nb) why = 'Same name, different spelling or punctuation';
      else if (na.length >= 5 && nb.length >= 5 && lev(na, nb) <= 2) why = 'Names are spelled almost the same';
      else if (ta.length >= 2 && tb.length >= 2 && ta[ta.length - 1] === tb[tb.length - 1] && (ta[0].startsWith(tb[0]) || tb[0].startsWith(ta[0])) && Math.min(ta[0].length, tb[0].length) >= 3) why = 'Same last name, similar first name';
      else if (ta.length >= 2 && tb.length >= 2 && (ta.every((t) => tb.includes(t)) || tb.every((t) => ta.includes(t)))) why = 'One name has an extra middle or last name';
      else if ((ta.length === 1) !== (tb.length === 1) && ta[0] === tb[0]) why = 'One is a first name only';
      if (why) out.push({ a: A, b: B, why });
    }
    return out;
  }
  // Rename every order of the "from" people to keepName. Returns an undo function.
  function mergeCustomers(fromKeys, keepName) {
    const before = [];
    S.vault.orders.forEach((o) => { if (fromKeys.includes(custKey(o.name)) && o.name !== keepName) { before.push([o, o.name]); o.name = keepName; } });
    touch();
    return () => { before.forEach(([o, n]) => (o.name = n)); touch(); render(); };
  }
  const personCard = (p, sel, radioName) => `<label class="dcard">
      <input type="radio" name="${radioName}" value="${esc(p.name)}"${sel ? ' checked' : ''}>
      ${avatar(p.name)}<span class="dc-body"><b>${esc(p.name)}</b>
      <small>${(() => { const dec = p.orders.filter((o) => o.status === 'Declined').length, act = p.orders.length - dec; return [act ? plural(act, 'order') + ' · ' + money(p.spent) : '', dec ? plural(dec, 'declined inquiry', 'declined inquiries') : ''].filter(Boolean).join(' · '); })()} · last ${esc(fmtDate(p.last)) || '—'}</small>
      ${p.phone || p.email ? `<small>${esc(p.phone || p.email)}</small>` : ''}</span></label>`;

  function openDupes() {
    const dlg = $('#dlg');
    const draw = () => {
      const pairs = dupePairs();
      dlg.innerHTML = `<div class="tagger" id="dup">
        <div class="tg-top"><h2 style="margin:0">Possible duplicates</h2><span style="flex:1"></span><button class="btn ghost small" data-x>Done</button></div>
        ${pairs.length ? `<p class="muted" style="margin:0">These look like they could be the same person. Nothing is merged unless you press Merge. Pick the name to keep, or say they are different people.</p>
          ${pairs.map((d, i) => `<div class="dpair" data-i="${i}"><div class="dwhy">${esc(d.why)}</div>
            <div class="dcards">${personCard(d.a, (d.a.name.length >= d.b.name.length), 'keep' + i)}${personCard(d.b, (d.b.name.length > d.a.name.length), 'keep' + i)}</div>
            <div class="actions"><button type="button" class="btn small" data-merge="${i}">Merge, keep selected name</button><button type="button" class="btn ghost small" data-notdupe="${i}">Not the same person</button></div></div>`).join('')}`
        : '<p class="insight">✓ No possible duplicates left to review.</p>'}</div>`;
      $('#dup').onclick = (e) => {
        const t = e.target;
        if (t.closest('[data-x]')) { dlg.close(); return; }
        const m = t.closest('[data-merge]'), n = t.closest('[data-notdupe]');
        if (m) {
          const d = pairs[+m.dataset.merge], keep = dlg.querySelector(`input[name="keep${m.dataset.merge}"]:checked`).value;
          const undo = mergeCustomers([d.a.key, d.b.key], keep);
          toast(`Merged into ${keep}.`, { action: 'Undo', onAction: () => { undo(); if (dlg.open) draw(); } });
          draw(); return;
        }
        if (n) {
          const d = pairs[+n.dataset.notdupe];
          (S.vault.notDupes ||= []).push(pairKey(d.a.key, d.b.key)); touch();
          toast(`Got it: ${d.a.name} and ${d.b.name} are different people.`); draw();
        }
      };
    };
    dlg.onclose = () => { dlg.onclose = null; render(); };
    draw();
    if (!dlg.open) dlg.showModal();
  }

  function openMergeInto(key) {
    const dlg = $('#dlg'), me = people().find((p) => p.key === key); if (!me) return;
    const others = people().filter((p) => p.key !== key).sort((a, b) => a.name.localeCompare(b.name));
    dlg.innerHTML = `<div class="tagger" id="mg">
      <div class="tg-top"><h2 style="margin:0">Merge ${esc(me.name)} with…</h2><span style="flex:1"></span><button class="btn ghost small" data-back>Back</button></div>
      <p class="muted" style="margin:0">Choose the other customer record that is the same person. All of their orders will be listed under one name.</p>
      <label>Other customer<input id="mg-q" list="mg-list" placeholder="Start typing a name…" autocomplete="off"></label>
      <datalist id="mg-list">${others.map((p) => `<option value="${esc(p.name)}">${plural(p.orders.length, 'order')}</option>`).join('')}</datalist>
      <div id="mg-pick"></div></div>`;
    const pick = () => {
      const other = others.find((p) => p.name.toLowerCase() === $('#mg-q').value.trim().toLowerCase());
      $('#mg-pick').innerHTML = other ? `<p class="muted small" style="margin:6px 0">Which name should they have?</p>
        <div class="dcards">${personCard(me, me.name.length >= other.name.length, 'mgkeep')}${personCard(other, other.name.length > me.name.length, 'mgkeep')}</div>
        <div class="actions" style="margin-top:12px"><button type="button" class="btn" data-domerge="${esc(other.key)}">Merge</button></div>` : '';
    };
    $('#mg-q').addEventListener('input', pick);
    $('#mg').onclick = (e) => {
      const t = e.target;
      if (t.closest('[data-back]')) { openCustomer(key); return; }
      const go = t.closest('[data-domerge]');
      if (go) {
        const keep = dlg.querySelector('input[name="mgkeep"]:checked').value;
        const undo = mergeCustomers([key, go.dataset.domerge], keep);
        toast(`Merged into ${keep}.`, { action: 'Undo', onAction: undo });
        openCustomer(custKey(keep));
      }
    };
    setTimeout(() => $('#mg-q') && $('#mg-q').focus(), 50);
  }

  function openCustomer(key) {
    const c = customers().find((x) => x.key === key); if (!c) return;
    const dlg = $('#dlg');
    const ph = photos().filter((p) => c.orders.some((o) => o.id === p.orderId));
    const first = c.name.split(/\s+/)[0];
    dlg.innerHTML = `<div class="tagger cust" id="cu">
      <div class="cu-head">${avatar(c.name, 'lg')}<div><h2 style="margin:0">${esc(c.name)}</h2>
        <p class="muted" style="margin:2px 0 0">Customer since ${esc(fmtDate(c.first)) || '—'}${c.declined ? ` · ${plural(c.declined, 'other inquiry', 'other inquiries')}` : ''}</p></div>
        <span style="flex:1"></span><button class="btn ghost small" data-x>Close</button></div>
      <div class="cacts">${c.phone ? `<a class="btn ghost small" href="${esc(telHref(c.phone))}">${ico('phone')} Call</a><a class="btn ghost small" href="${esc(smsHref(c.phone))}">${ico('chat')} Text</a>` : ''}${c.email ? `<a class="btn ghost small" href="mailto:${esc(c.email)}">${ico('mail')} Email</a>` : ''}
        ${c.phone || c.email || c.social ? `<span class="muted small">${[c.phone, c.email, c.social].filter(Boolean).map(esc).join(' · ')}${c.prefer ? ` · prefers ${esc(c.prefer)}` : ''}</span>` : '<span class="muted small">No contact info yet. Add it below.</span>'}</div>
      <div class="ministats">
        <div><b>${money(c.spent)}</b><span>Spent</span></div><div><b>${c.count}</b><span>${c.count === 1 ? 'Order' : 'Orders'}</span></div>
        <div><b>${money(c.count ? c.spent / c.count : 0)}</b><span>Average order</span></div><div><b>${c.cookies.toLocaleString()}</b><span>Cookies</span></div>
        <div><b class="${c.owed > 0.005 ? 'neg' : ''}">${money(c.owed)}</b><span>Owed</span></div></div>
      ${c.occ.length ? `<div class="occchips">${c.occ.map(([n, k]) => `<span class="pill">${OCC_EMOJI[n] || ''} ${esc(n)} · ${k}</span>`).join('')}</div>` : ''}
      <h3>Order history</h3>
      <div class="hist">${c.orders.map((o) => `<button type="button" class="hrow st-${o.status}" data-oid="${o.id}"><span>${esc(fmtDate(o.due || o.requested)) || 'No date'}</span><span class="h-ev">${esc(o.event || o.type || '—')}</span><span>${cookiesOf(o.qty)}</span><span>${o.amtDue == null ? '' : money(o.amtDue)}</span><span class="pill st-${o.status}">${o.status}</span></button>`).join('')}</div>
      ${ph.length ? `<h3>Photos</h3><div class="pgrid small" id="cphotos">${ph.map((x) => `<button class="ptile" data-pid="${x.id}" aria-label="Photo"></button>`).join('')}</div>` : ''}
      <details class="cedit"><summary>Edit contact info</summary>
        <div class="fgrid">
          <label>Phone<input name="phone" type="tel" value="${esc(c.phone)}"></label><label>Email<input name="email" type="email" value="${esc(c.email)}"></label>
          <label>Facebook or Instagram<input name="social" value="${esc(c.social)}"></label>
          <label>Best way to reach them<select name="prefer">${['', 'Text', 'Call', 'Email', 'Facebook', 'Instagram'].map((v) => `<option value="${v}"${v === c.prefer ? ' selected' : ''}>${v || '— select —'}</option>`).join('')}</select></label>
        </div>
        <button type="button" class="btn small" data-savecontact>Save to all ${plural(c.count + c.declined, 'order')}</button></details>
      <div class="actions"><button type="button" class="btn" data-neworder>+ New order for ${esc(first)}</button><button type="button" class="btn ghost" data-mergewith>Merge with another customer…</button></div></div>`;
    const cp = $('#cphotos'); if (cp) lazyThumbs(cp);
    $('#cu').onclick = (e) => {
      const t = e.target;
      if (t.closest('[data-x]')) { dlg.close(); return; }
      const h = t.closest('[data-oid]'); if (h) { dlg.onclose = null; dlg.close(); openEdit(h.dataset.oid); return; }
      if (t.closest('[data-mergewith]')) { openMergeInto(key); return; }
      if (t.closest('[data-neworder]')) { dlg.onclose = null; dlg.close(); openEdit(null, { name: c.name, phone: c.phone, email: c.email, social: c.social, prefer: c.prefer }); return; }
      const pt = t.closest('[data-pid]'); if (pt) { const ids = ph.map((x) => x.id); openViewer(ids, ids.indexOf(pt.dataset.pid)); return; }
      if (t.closest('[data-savecontact]')) {
        const box = $('#cu .cedit'), v = (n) => box.querySelector(`[name=${n}]`).value;
        const vals = { phone: fixPhone(v('phone')), email: fixEmail(v('email')), social: tidySpace(v('social')), prefer: v('prefer') };
        S.vault.orders.filter((o) => custKey(o.name) === key).forEach((o) => { Object.assign(o, vals); o.contact = ''; });
        touch(); toast(`Contact info saved for ${c.name}.`); openCustomer(key);
      }
    };
    dlg.onclose = () => { dlg.onclose = null; render(); };
    if (!dlg.open) dlg.showModal();
  }

  /* ---------- photos ---------- */
  const PHOTO_KINDS = [['finished', 'My work'], ['inspiration', 'Inspiration']];
  const newestFirst = (a, b) => (b.due || b.requested || '').localeCompare(a.due || a.requested || '');
  const orderLabel = (o) => `${o.name} · ${fmtDate(o.due || o.requested) || 'No date'}${o.event ? ' · ' + o.event : ''}`;
  const orderOptions = (sel, extra) => `<option value="">— None —</option>${S.vault.orders.filter((o) => o.status !== 'Declined' || o.id === sel).sort(newestFirst)
    .map((o) => `<option value="${o.id}"${o.id === sel ? ' selected' : ''}>${esc(orderLabel(o))}</option>`).join('')}`;
  const occOptions = (sel) => `<option value="">— None —</option>${OCCASIONS.map(([n]) => `<option${n === sel ? ' selected' : ''}>${esc(n)}</option>`).join('')}`;
  const kindOptions = (sel) => PHOTO_KINDS.map(([v, l]) => `<option value="${v}"${v === sel ? ' selected' : ''}>${l}</option>`).join('');

  function startUpload(files, preset, onDone) {
    if (!tok()) { toast('Photos are saved to GitHub. Add your GitHub token in Settings first.', { kind: 'bad' }); return; }
    if (!files.length) { toast('Those files are not pictures. Please drop image files such as JPG or PNG.', { kind: 'bad' }); return; }
    openUpload(files, preset, onDone);
  }
  function pickPhotos(preset = {}, onDone) {
    if (!tok()) { toast('Photos are saved to GitHub. Add your GitHub token in Settings first.', { kind: 'bad' }); return; }
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*'; inp.multiple = true; inp.hidden = true;
    inp.onchange = () => { const files = [...inp.files].filter((f) => f.type.startsWith('image/')); inp.remove(); if (files.length) openUpload(files, preset, onDone); };
    document.body.appendChild(inp);
    inp.click();
  }

  function openUpload(files, preset, onDone) {
    const dlg = $('#dlg2'), ord = preset.orderId ? byId(preset.orderId) : null;
    dlg.classList.remove('wide');
    const g = ord ? occasionOf(ord) : null;
    dlg.innerHTML = `<form class="tagger" id="up" novalidate>
      <div class="tg-top"><h2 style="margin:0">Add ${plural(files.length, 'photo')}</h2></div>
      ${ord ? `<p class="muted" style="margin:0">For <b>${esc(ord.name)}</b> · ${esc(fmtDate(ord.due || ord.requested)) || 'No date'}${ord.event ? ' · ' + esc(ord.event) : ''}</p>` : ''}
      <div class="fgrid">
        <label>Type<select name="kind">${kindOptions('finished')}</select></label>
        <label>Occasion<select name="occasion">${occOptions(g && g.name !== 'Not set' ? g.name : '')}</select></label>
        <label class="wide">Customer or order<select name="orderId"${ord ? ' disabled' : ''}>${orderOptions(preset.orderId || '')}</select></label>
        <label class="wide">Caption (optional)<input name="caption" placeholder="For example, pink floral set"></label>
      </div>
      <div class="up-list">${files.map((f, i) => `<div class="up-row" data-i="${i}"><span>${esc(f.name)}</span><span class="muted small" data-st>Waiting</span></div>`).join('')}</div>
      <div class="actions"><button class="btn" type="submit" id="up-go">Upload</button><button class="btn ghost" type="button" data-x>Cancel</button></div></form>`;
    const form = $('#up');
    let busy = false;
    form.onclick = (e) => { if (e.target.closest('[data-x]') && !busy) dlg.close(); };
    form.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(form); // read before locking the fields (disabled fields are not included)
      busy = true; form.querySelectorAll('select,input,button').forEach((x) => (x.disabled = true));
      const kind = fd.get('kind') || 'finished'; const orderId = ord ? ord.id : fd.get('orderId') || null;
      let occasion = fd.get('occasion') || '';
      const linked = orderId ? byId(orderId) : null;
      if (!occasion && linked) { const o2 = occasionOf(linked); if (o2.name !== 'Not set') occasion = o2.name; }
      let ok = 0;
      for (let i = 0; i < files.length; i++) {
        const st = form.querySelector(`.up-row[data-i="${i}"] [data-st]`), f = files[i];
        try {
          st.textContent = 'Resizing…';
          const { full, thumb } = await makeVersions(f);
          st.textContent = 'Encrypting…';
          const id = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
          const fb = await encBytes(new Uint8Array(await full.blob.arrayBuffer())), tb = await encBytes(new Uint8Array(await thumb.blob.arrayBuffer()));
          st.textContent = 'Uploading…';
          await withLock(() => ghPutFile(`${DATA.photos}/${id}.f.bin`, fb));
          await withLock(() => ghPutFile(`${DATA.photos}/${id}.t.bin`, tb));
          photoCache.set(id + 'f', Promise.resolve(URL.createObjectURL(full.blob)));
          photoCache.set(id + 't', Promise.resolve(URL.createObjectURL(thumb.blob)));
          photos().push({ id, kind, orderId, occasion, caption: String(fd.get('caption') || '').trim(), date: isoDate(new Date(f.lastModified || Date.now())), w: full.w, h: full.h, added: todayISO() });
          touch(); ok++;
          st.textContent = 'Done ✓';
        } catch (err) { st.textContent = /heic|heif/i.test(f.type + f.name) ? 'This browser cannot read HEIC photos. Please use JPG or PNG.' : 'Failed: ' + (err.message || err); st.classList.add('neg'); }
      }
      busy = false;
      const done = form.querySelector('.actions');
      done.innerHTML = `<span class="${ok === files.length ? 'ok' : 'neg'}">${ok === files.length ? `✓ ${plural(ok, 'photo')} added` : `${ok} of ${files.length} added`}</span><button class="btn" type="button" data-x>Close</button>`;
      if (ok === files.length) setTimeout(() => { if (dlg.open) dlg.close(); }, 900);
    };
    dlg.onclose = () => { dlg.onclose = null; if (onDone) onDone(); render(); };
    dlg.showModal();
  }

  function openViewer(ids, index, onClose) {
    const dlg = $('#dlg2');
    ids = [...ids];
    let i = Math.max(0, index);
    const draw = () => {
      const ph = photoById(ids[i]);
      if (!ph) { dlg.close(); return; }
      dlg.innerHTML = `<div class="viewer pane" id="pv">
        <div class="pv-main">
          <div class="pv-top"><span>${i + 1} of ${ids.length}</span><span style="flex:1"></span><button class="btn ghost small" data-dl>Download</button><button class="btn small" data-x>Close</button></div>
          <div class="pv-stage"><button class="pv-nav" data-prev aria-label="Previous photo"${i ? '' : ' disabled'}>‹</button>
            <div class="pv-box"><img id="pv-img" alt="${esc(ph.caption || 'Cookie photo')}"><div class="pv-load" id="pv-load">Loading…</div></div>
            <button class="pv-nav" data-next aria-label="Next photo"${i < ids.length - 1 ? '' : ' disabled'}>›</button></div>
        </div>
        <aside class="pv-side">
          <h3 style="margin:0">Photo details</h3>
          <div class="fgrid pv-form">
            <label>Type<select name="kind">${kindOptions(ph.kind)}</select></label>
            <label>Occasion<select name="occasion">${occOptions(ph.occasion)}</select></label>
            <label>Date<input type="date" name="date" value="${esc(ph.date)}"></label>
            <label class="wide">Customer or order<select name="orderId">${orderOptions(ph.orderId || '')}</select></label>
            <label class="wide">Caption<input name="caption" value="${esc(ph.caption)}" placeholder="Add a caption"></label>
          </div>
          <div class="actions"><button class="btn danger small" data-del>Delete photo</button>${ph.orderId && byId(ph.orderId) ? '<button class="btn ghost small" data-openorder>Open order</button>' : ''}</div>
        </aside></div>`;
      const img = $('#pv-img');
      photoUrl(ph.id, 't').then((u) => { if (!img.dataset.full && ids[i] === ph.id) img.src = u; }).catch(() => {});
      photoUrl(ph.id, 'f').then((u) => { if (ids[i] === ph.id) { img.dataset.full = '1'; img.src = u; const l = $('#pv-load'); if (l) l.remove(); } })
        .catch(() => { const l = $('#pv-load'); if (l) l.textContent = 'Could not load this photo.'; });
    };
    const go = (d) => { const n = i + d; if (n >= 0 && n < ids.length) { i = n; draw(); } };
    dlg.onclick = async (e) => {
      const t = e.target, ph = photoById(ids[i]);
      if (!ph) return;
      if (t.closest('[data-x]')) { dlg.close(); return; }
      if (t.closest('[data-prev]')) { go(-1); return; }
      if (t.closest('[data-next]')) { go(1); return; }
      if (t.closest('[data-dl]')) {
        const u = await photoUrl(ph.id, 'f').catch(() => null); if (!u) return;
        const a = document.createElement('a'); a.href = u; a.download = `cookies-${(ph.caption || ph.id).replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.jpg`; a.click(); return;
      }
      if (t.closest('[data-openorder]')) { const oid = ph.orderId; dlg.onclick = null; dlg.onclose = null; dlg.close(); $('#dlg').close?.(); S.tab = 'orders'; render(); openEdit(oid); return; }
      if (t.closest('[data-del]')) {
        if (!confirm('Delete this photo? This cannot be undone.')) return;
        const id = ph.id;
        S.vault.photos = photos().filter((x) => x.id !== id); ids.splice(i, 1); touch();
        if (tok()) withLock(() => ghDeleteFile(`${DATA.photos}/${id}.f.bin`)).then(() => withLock(() => ghDeleteFile(`${DATA.photos}/${id}.t.bin`))).catch(() => {});
        photoCache.delete(id + 'f'); photoCache.delete(id + 't');
        if (!ids.length) { dlg.close(); return; }
        i = Math.min(i, ids.length - 1); draw();
      }
    };
    dlg.onchange = (e) => {
      const ph = photoById(ids[i]), f = e.target.name; if (!ph || !f) return;
      if (f === 'orderId') {
        ph.orderId = e.target.value || null;
        const lo = ph.orderId ? byId(ph.orderId) : null;
        if (lo && !ph.occasion) { const o2 = occasionOf(lo); if (o2.name !== 'Not set') ph.occasion = o2.name; }
        touch(); draw(); return;
      }
      ph[f] = e.target.value.trim ? e.target.value.trim() : e.target.value; touch();
    };
    dlg.onkeydown = (e) => { if (e.key === 'ArrowLeft') go(-1); if (e.key === 'ArrowRight') go(1); };
    dlg.classList.add('wide');
    dlg.onclose = () => { dlg.classList.remove('wide'); dlg.onclick = null; dlg.onchange = null; dlg.onkeydown = null; dlg.onclose = null; if (onClose) onClose(); render(); };
    draw();
    dlg.showModal();
  }

  function viewPhotos(main) {
    const all = photos();
    const years = [...new Set(all.map((x) => (x.date || '').slice(0, 4)).filter(Boolean))].sort().reverse();
    const mine = all.filter((x) => x.kind === 'finished').length, insp = all.length - mine;
    const chip = (k, l, c) => `<button class="chip" data-pk="${k}" aria-selected="${S.pKind === k}">${l} (${c})</button>`;
    main.innerHTML = `${pageHead('Photos', `${plural(all.length, 'photo')} · ${mine} my work · ${insp} inspiration`, '<button class="btn small" data-photoadd>+ Add photos</button>')}
      ${tok() ? '' : '<div class="notice">Photos are saved to your GitHub repository, so add your token in <button class="linkbtn" data-tab="settings">Settings</button> before uploading. You can still look at photos that are already saved.</div>'}
      <div class="bar"><input class="grow" id="pq" type="search" placeholder="Search captions and customers…" value="${esc(S.pq)}"></div>
      <div class="bar">${chip('all', 'All', all.length)}${chip('finished', 'My work', mine)}${chip('inspiration', 'Inspiration', insp)}<span class="sp"></span>
        <select id="p-occ" aria-label="Occasion"><option value="">All occasions</option>${OCCASIONS.map(([n]) => `<option${S.pOcc === n ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select>
        <select id="p-year" aria-label="Year"><option value="All">All years</option>${years.map((y) => `<option${S.pYear === y ? ' selected' : ''}>${y}</option>`).join('')}</select></div>
      <div id="pgrid" class="pgrid masonry"></div>`;
    const draw = () => {
      const q = S.pq.toLowerCase();
      const list = all.filter((x) => (S.pKind === 'all' || x.kind === S.pKind) && (!S.pOcc || x.occasion === S.pOcc) && (S.pYear === 'All' || (x.date || '').startsWith(S.pYear))
        && (!q || [x.caption, x.occasion, (byId(x.orderId) || {}).name].join(' ').toLowerCase().includes(q)))
        .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.added || '').localeCompare(a.added || ''));
      const grid = $('#pgrid');
      grid.classList.toggle('masonry', list.length > 0);
      grid.innerHTML = list.length ? list.map((x) => {
        const o = byId(x.orderId);
        return `<button class="ptile" data-pid="${x.id}" style="--ar:${x.w || 1} / ${x.h || 1}" aria-label="${esc(x.caption || (o && o.name) || 'Photo')}">
          ${x.kind === 'inspiration' ? '<span class="ptag" title="Inspiration">💡</span>' : ''}
          <span class="pcap">${o ? `<b>${esc(o.name)}</b>` : ''}${x.caption ? `<span>${esc(x.caption)}</span>` : x.occasion ? `<span>${esc(x.occasion)}</span>` : ''}</span></button>`;
      }).join('') : `<div class="empty"><div style="font-size:2.4rem">📷</div><p><b>${all.length ? 'No photos match these filters.' : 'No photos yet.'}</b></p>
          <p class="muted">${all.length ? 'Try clearing the search or filters.' : 'Add pictures of your finished cookies, or inspiration pictures that customers send you. You can also drag pictures onto this page.'}</p></div>`;
      lazyThumbs(grid);
      grid.onclick = (e) => { const t = e.target.closest('[data-pid]'); if (t) { const ids = list.map((x) => x.id); openViewer(ids, ids.indexOf(t.dataset.pid)); } };
    };
    drawPhotoGrid = draw;
    draw();
  }
  let drawPhotoGrid = () => {};

  // ---------- drag and drop (pictures from your computer) ----------
  const hasFiles = (e) => e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');
  const imageFiles = (dt) => [...dt.files].filter((f) => f.type.startsWith('image/') || /\.(jpe?g|png|gif|webp|heic|heif)$/i.test(f.name));
  let hotEl = null;
  const setHot = (el) => { if (hotEl === el) return; if (hotEl) hotEl.classList.remove('drop-hot'); hotEl = el; if (el) el.classList.add('drop-hot'); };
  function dropZone(target) {
    if (!(target instanceof Element)) return null;
    const editor = target.closest('#ophotos[data-oid]');
    if (editor) return { el: editor, preset: { orderId: editor.dataset.oid }, done: editor._refresh };
    if (target.closest('dialog')) return null;
    const row = target.closest('.orow[data-id]');
    if (row && S.tab === 'orders') return { el: row, preset: { orderId: row.dataset.id } };
    if (S.tab === 'photos' && target.closest('#main')) return { el: $('#main'), preset: {} };
    return null;
  }
  ['dragenter', 'dragover'].forEach((ev) => window.addEventListener(ev, (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault(); // also stops the browser from opening the dropped file
    const z = dropZone(e.target);
    setHot(z ? z.el : null);
    e.dataTransfer.dropEffect = z ? 'copy' : 'none';
  }));
  window.addEventListener('dragleave', (e) => {
    if (!hotEl) return;
    if (!e.relatedTarget) { setHot(null); return; }
    const z = dropZone(e.relatedTarget);
    if (!z || z.el !== hotEl) setHot(null);
  });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    const z = dropZone(e.target);
    setHot(null);
    if (!z) return;
    startUpload(imageFiles(e.dataTransfer), z.preset, z.done);
  });

  /* ---------- revenue by occasion ---------- */
  function occasionSection(year) {
    const scope = S.occScope || 'year';
    const list = S.vault.orders.filter((o) => o.status === 'Completed' && (scope === 'all' || (o.due || o.requested || '').startsWith(year)));
    const g = {};
    let guessed = 0;
    for (const o of list) {
      const oc = occasionOf(o);
      const r = (g[oc.name] ||= { name: oc.name, rev: 0, orders: 0, cookies: 0, guess: 0 });
      r.rev += num(o.paid); r.orders++; r.cookies += num(o.qty);
      if (oc.source === 'guessed') { r.guess++; guessed++; }
    }
    const unk = g['Not set'];
    const rows = Object.values(g).filter((r) => r.name !== 'Not set').sort((a, b) => b.rev - a.rev);
    const total = list.reduce((s, o) => s + num(o.paid), 0);
    const max = Math.max(1, ...rows.map((r) => r.rev), unk ? unk.rev : 0);
    const known = list.length - (unk ? unk.orders : 0);
    const cov = list.length ? Math.round(known / list.length * 100) : 100;
    const untagged = S.vault.orders.filter((o) => o.status === 'Completed' && !(o.type || '').trim()).length;
    const top = rows[0];
    const nCheck = labelCount(labelIssues());
    const row = (r, cls = '') => `<div class="orr ${cls}">
        <span class="on"><span class="oe">${OCC_EMOJI[r.name] || '🍪'}</span><span class="oname">${esc(r.name)}${r.guess ? `<small title="Guessed from the event name">${r.guess} guessed</small>` : ''}</span></span>
        <span class="obar"><i style="width:${Math.max(2, r.rev / max * 100)}%"></i></span>
        <span class="ov">${money(r.rev)}</span><span class="op">${total ? Math.round(r.rev / total * 100) : 0}%</span>
        <span class="oc">${r.orders} order${r.orders === 1 ? '' : 's'}</span><span class="oa">${r.orders ? money(r.rev / r.orders) : '—'} avg</span></div>`;
    return `<div class="panel occ">
      <div class="mhead"><h3>Revenue by occasion</h3>
        <div class="seg" role="group" aria-label="Period"><button data-occscope="year" aria-pressed="${scope === 'year'}">${year}</button><button data-occscope="all" aria-pressed="${scope === 'all'}">All time</button></div></div>
      ${top ? `<p class="insight"><b>${esc(top.name)}</b> is your top occasion — ${money(top.rev)}, ${total ? Math.round(top.rev / total * 100) : 0}% of ${scope === 'all' ? 'all-time' : year} revenue.</p>` : ''}
      <div class="cover"><div class="covbar"><i style="width:${cov}%"></i></div>
        <span>${cov === 100 ? '✓ Every order has an occasion' : `Occasion is known for <b>${known}</b> of <b>${list.length}</b> orders (${cov}%)`}${guessed ? ` · ${guessed} guessed from the event name` : ''}</span>
        ${untagged ? `<button class="btn small" data-tag>Tag ${untagged} order${untagged === 1 ? '' : 's'}</button>` : ''}
        ${nCheck ? `<button class="btn ghost small" data-check>Check labels (${nCheck})</button>` : ''}</div>
      <div class="orr ohd"><span>Occasion</span><span></span><span class="ov">Collected</span><span class="op">Share</span><span class="oc">Orders</span><span class="oa">Average</span></div>
      ${rows.map((r) => row(r)).join('') || '<p class="muted">No completed orders in this period.</p>'}
      ${unk ? row(unk, 'unk') : ''}
      ${unk ? '<p class="muted small">“Not set” orders have no occasion yet, so they are not in any group above. Use <b>Tag orders</b> to fill them in quickly.</p>' : ''}
    </div>`;
  }

  /* ---------- check labels ---------- */
  // Finds orders whose occasion looks inconsistent with their event name.
  function labelIssues() {
    const out = { wrong: [], vague: [], tidy: [] };
    for (const o of S.vault.orders) {
      if (o.status === 'Declined') continue;
      const raw = (o.type || '').trim();
      if (!raw) continue; // blanks are handled by "Tag orders"
      const name = OCC_LEGACY[raw.toLowerCase()] || raw;
      if (name !== raw) out.tidy.push({ o, current: raw, suggest: name });
      if (o.occOk) continue;
      const hit = OCC_RULES.find(([re]) => re.test([o.event, o.notes, o.colors].join(' ')));
      if (!hit || hit[1] === name) continue;
      const generic = name === 'Party / Event' || name === 'Other';
      if (!generic && hit[1] === 'Party / Event') continue; // "party" alone doesn't contradict a specific occasion
      (generic ? out.vague : out.wrong).push({ o, current: raw, suggest: hit[1] });
    }
    const byDate = (a, b) => (b.o.due || b.o.requested || '').localeCompare(a.o.due || a.o.requested || '');
    out.wrong.sort(byDate); out.vague.sort(byDate);
    return out;
  }
  const labelCount = (iss) => iss.wrong.length + iss.vague.length + (iss.tidy.length ? 1 : 0);

  function openLabelCheck() {
    const dlg = $('#dlg');
    const item = ({ o, current, suggest }, kind) => `<div class="lc-item">
      <div class="lc-head"><b>${esc(o.name)}</b><span class="muted small">${esc(fmtDate(o.due || o.requested)) || 'No date'} · ${cookiesOf(o.qty)} · ${money(o.paid ?? o.amtDue ?? 0)}</span></div>
      <div class="lc-ev">“${esc(o.event || o.notes || o.colors)}”</div>
      <div class="lc-change"><span class="pill">${OCC_EMOJI[OCC_LEGACY[current.toLowerCase()] || current] || ''} ${esc(current)}</span><span aria-hidden="true">→</span><span class="pill lc-new">${OCC_EMOJI[suggest] || ''} ${esc(suggest)}</span></div>
      <div class="actions"><button class="btn small" data-use="${o.id}" data-kind="${kind}">Use ${esc(suggest)}</button>
        <button class="btn ghost small" data-keep="${o.id}">Keep ${esc(current)}</button>
        <button class="btn ghost small" data-edit="${o.id}">Edit order</button></div></div>`;
    const draw = () => {
      const iss = labelIssues(), total = labelCount(iss);
      dlg.innerHTML = `<div class="tagger" id="lc">
        <div class="tg-top"><h2 style="margin:0">Check labels</h2><span class="sp" style="flex:1"></span><button class="btn ghost small" data-x>Done</button></div>
        ${total ? `<p class="muted">Orders where the event name points to a different occasion than the label. Your labels are never changed unless you choose.</p>` : '<p class="insight">✓ Everything looks consistent. Nothing to check.</p>'}
        ${iss.wrong.length ? `<h3>Might be labeled wrong <span class="muted">(${iss.wrong.length})</span></h3>${iss.wrong.map((x) => item(x, 'wrong')).join('')}` : ''}
        ${iss.vague.length ? `<div class="lc-sec"><h3>Could be more specific <span class="muted">(${iss.vague.length})</span></h3>
          <button class="btn small" data-useall>Apply all ${iss.vague.length}</button></div>${iss.vague.map((x) => item(x, 'vague')).join('')}` : ''}
        ${iss.tidy.length ? `<h3>Tidy names <span class="muted">(${plural(iss.tidy.length, 'order')})</span></h3>
          <div class="lc-item"><p style="margin:0">Same meaning, different spelling — for example ${[...new Set(iss.tidy.map((x) => `“${esc(x.current)}” → ${esc(x.suggest)}`))].slice(0, 5).join(', ')}.</p>
          <div class="actions"><button class="btn small" data-tidy>Standardize ${plural(iss.tidy.length, 'name')}</button></div></div>` : ''}
      </div>`;
      $('#lc').onclick = (e) => {
        const t = e.target;
        const find = (id) => [...iss.wrong, ...iss.vague].find((x) => x.o.id === id);
        const use = t.closest('[data-use]'), keep = t.closest('[data-keep]'), edit = t.closest('[data-edit]');
        if (use) { const x = find(use.dataset.use); if (x) { x.o.type = x.suggest; touch(); draw(); } return; }
        if (keep) { const x = find(keep.dataset.keep); if (x) { x.o.occOk = true; touch(); draw(); } return; }
        if (edit) { dlg.onclose = null; dlg.close(); render(); openEdit(edit.dataset.edit); return; }
        if (t.closest('[data-useall]')) {
          if (confirm(`Change ${iss.vague.length} generic labels to the more specific occasion?`)) { iss.vague.forEach((x) => (x.o.type = x.suggest)); touch(); draw(); }
          return;
        }
        if (t.closest('[data-tidy]')) { iss.tidy.forEach((x) => (x.o.type = x.suggest)); touch(); draw(); return; }
        if (t.closest('[data-x]')) dlg.close();
      };
    };
    dlg.onclose = () => { dlg.onclose = null; render(); };
    draw();
    dlg.showModal();
  }

  function openTidyText() {
    const dlg = $('#dlg'), list = tidyChanges();
    if (!list.length) return;
    dlg.innerHTML = `<div class="tagger" id="tt"><div class="tg-top"><h2 style="margin:0">Tidy up text</h2><span style="flex:1"></span><button class="btn ghost small" data-x>Cancel</button></div>
      <p class="muted">${plural(list.length, 'change')} to review. Nothing changes until you apply them.</p>
      <div class="tt-list">${list.map((c) => `<div class="tt-row"><span class="muted small">${esc(TEXT_LABELS[c.f])} · ${esc(c.o.name)}</span>
        <span><s>${esc(c.from)}</s> → <b>${esc(c.to)}</b></span></div>`).join('')}</div>
      <div class="actions"><button class="btn" data-apply>Apply ${plural(list.length, 'change')}</button><button class="btn ghost" data-x>Cancel</button></div></div>`;
    $('#tt').onclick = (e) => {
      if (e.target.closest('[data-apply]')) { list.forEach((c) => (c.o[c.f] = c.to)); touch(); dlg.close(); render(); return; }
      if (e.target.closest('[data-x]')) dlg.close();
    };
    dlg.onclose = () => { dlg.onclose = null; render(); };
    dlg.showModal();
  }

  function openTagger() {
    const queue = S.vault.orders.filter((o) => o.status === 'Completed' && !(o.type || '').trim())
      .sort((a, b) => (b.due || b.requested || '').localeCompare(a.due || a.requested || ''));
    if (!queue.length) return;
    const dlg = $('#dlg');
    let i = 0, tagged = 0;
    const draw = () => {
      if (i >= queue.length) {
        dlg.innerHTML = `<div class="tagger" id="tg"><h2>All done 🎉</h2><p>You tagged <b>${tagged}</b> order${tagged === 1 ? '' : 's'}.</p><div class="actions"><button class="btn" data-x>Close</button></div></div>`;
      } else {
        const o = queue[i], g = occasionOf(o);
        dlg.innerHTML = `<div class="tagger" id="tg">
          <div class="tg-top"><span class="muted">${i + 1} of ${queue.length}</span><div class="tg-prog"><i style="width:${i / queue.length * 100}%"></i></div><button class="btn ghost small" data-x>Done</button></div>
          <div class="tg-card"><b>${esc(o.name)}</b><span>${esc(fmtDate(o.due || o.requested)) || 'No date'} · ${cookiesOf(o.qty)} · ${money(o.paid ?? o.amtDue ?? 0)}</span>
            ${o.event ? `<span>Event: ${esc(o.event)}</span>` : ''}${o.colors ? `<span>Colors: ${esc(o.colors)}</span>` : ''}${o.notes ? `<span class="muted">${esc(o.notes)}</span>` : ''}</div>
          <p class="muted small">What was the occasion?</p>
          <div class="tg-grid">${OCCASIONS.map(([n, e]) => `<button class="chip tg-btn${g.name === n ? ' sug' : ''}" data-occ="${esc(n)}"><span>${e}</span>${esc(n)}${g.name === n ? ' <small>suggested</small>' : ''}</button>`).join('')}</div>
          <div class="actions"><button class="btn ghost small" data-back${i ? '' : ' disabled'}>‹ Back</button><button class="btn ghost small" data-skip>Skip</button></div></div>`;
      }
      $('#tg').onclick = (e) => {
        const t = e.target;
        const occ = t.closest('[data-occ]');
        if (occ) { queue[i].type = occ.dataset.occ; tagged++; touch(); i++; draw(); return; }
        if (t.closest('[data-skip]')) { i++; draw(); return; }
        if (t.closest('[data-back]') && i > 0) { i--; if (queue[i].type) { queue[i].type = ''; tagged = Math.max(0, tagged - 1); touch(); } draw(); return; }
        if (t.closest('[data-x]')) { dlg.close(); render(); }
      };
    };
    dlg.onclose = () => { dlg.onclose = null; render(); };
    draw();
    dlg.showModal();
  }

  function insightsSection() {
    const ins = insights(), maxR = Math.max(1, ...ins.reasons.map((r) => r[1]));
    const fact = (icon, big, text) => `<div class="fact">${ico(icon)}<b>${big}</b><span>${text}</span></div>`;
    return `<div class="panel insights"><div class="mhead"><h3>Insights</h3><span class="muted small">From all ${plural(S.vault.orders.length, 'order')} and inquiries</span></div>
      <div class="factgrid">
        ${fact('repeat', Math.round(ins.repeatPct * 100) + '%', `of customers came back (${ins.repeat} of ${ins.customers}). Repeat customers brought in <b>${Math.round(ins.repeatShare * 100)}%</b> of your revenue.`)}
        ${ins.leadMedian !== null ? fact('cal', plural(ins.leadMedian, 'day'), `is the usual time between an order and its pickup. ${Math.round(ins.leadShort * 100)}% came in less than a week ahead.`) : ''}
        ${fact('trend', monthName(ins.busiest), `is your busiest month, with ${plural(ins.byMon[ins.busiest], 'completed order')} over the years.`)}
        ${fact('orders', Math.round(ins.conv * 100) + '%', 'of all inquiries turned into a completed order.')}
        ${fact('money', money(ins.avgOrder), 'is your average completed order.')}
        ${ins.busy ? fact('clock', String(ins.busy), `${ins.busy === 1 ? 'request was' : 'requests were'} turned down because you were too busy or it was too rushed.`) : ''}
      </div>
      ${ins.reasons.length ? `<h3 style="margin-top:18px">Why inquiries didn't become orders</h3>${ins.reasons.slice(0, 7).map(([r, n]) => `<div class="hbar"><span>${esc(r)}</span><i style="width:${Math.max(3, n / maxR * 100)}%"></i><span>${n}</span></div>`).join('')}` : ''}
    </div>`;
  }

  /* ---------- monthly revenue ---------- */
  function monthStats(year) {
    const arr = Array.from({ length: 12 }, (_, i) => ({ i, rev: 0, orders: 0, cookies: 0, up: 0, upN: 0 }));
    for (const o of S.vault.orders) {
      const d = o.due || o.requested || '';
      if (!d.startsWith(year)) continue;
      const m = +d.slice(5, 7) - 1;
      if (m < 0 || m > 11) continue;
      if (o.status === 'Completed') { arr[m].orders++; arr[m].cookies += num(o.qty); }
      else if (OPEN.includes(o.status)) { const left = Math.max(num(o.amtDue) - num(o.paid), 0); if (left > 0) { arr[m].up += left; arr[m].upN++; } }
    }
    const cm = cashByMonth();
    arr.forEach((m) => { m.rev = Math.round((cm[`${year}-${pad(m.i + 1)}`] || 0) * 100) / 100; });
    return arr;
  }
  function niceScale(max) {
    const steps = [10, 25, 50, 100, 250, 500, 1000, 2000, 2500, 5000, 10000];
    const step = steps.find((s) => max / s <= 5) || 20000;
    const top = Math.max(step, Math.ceil(max / step) * step);
    const ticks = []; for (let t = 0; t <= top; t += step) ticks.push(t);
    return { top, ticks };
  }
  const short$ = (v) => (v >= 1000 ? '$' + (v / 1000).toFixed(v >= 10000 ? 0 : 1).replace(/\.0$/, '') + 'k' : '$' + Math.round(v));
  const pct = (a, b) => (b > 0 ? Math.round((a - b) / b * 100) : null);

  function monthlySection(year) {
    const cur = monthStats(year), prev = monthStats(String(+year - 1));
    const hasPrev = prev.some((m) => m.rev > 0);
    const now = new Date(), isThisYear = String(now.getFullYear()) === String(year);
    const elapsed = isThisYear ? now.getMonth() + 1 : String(year) > String(now.getFullYear()) ? 0 : 12;
    const mName = (i, style) => new Date(2000, i, 1).toLocaleDateString(undefined, { month: style });
    const total = cur.reduce((a, m) => a + m.rev, 0);
    const prevSame = prev.slice(0, elapsed || 12).reduce((a, m) => a + m.rev, 0);
    const change = hasPrev ? pct(total, prevSame) : null;
    const best = cur.reduce((b, m) => (m.rev > b.rev ? m : b), cur[0]);
    const avg = elapsed ? total / elapsed : 0;
    const { top, ticks } = niceScale(Math.max(...cur.map((m) => m.rev + m.up), ...(hasPrev ? prev.map((m) => m.rev) : [0]), 1));
    const h = (v) => (v / top * 100).toFixed(2);
    const upTotal = cur.reduce((a, m) => a + m.up, 0);

    const cols = cur.map((m, i) => {
      const p = prev[i];
      const tip = `${mName(i, 'long')} ${year}: ${money(m.rev)} collected · ${plural(m.orders, 'order')} · ${plural(m.cookies, 'cookie')}`
        + (m.up ? ` · ${money(m.up)} still to collect on ${m.upN} open order${m.upN === 1 ? '' : 's'}` : '') + (hasPrev ? ` · last year ${money(p.rev)}` : '');
      const label = m.rev > 0 ? short$(m.rev) : m.up > 0 ? '+' + short$(m.up) : '';
      const isNow = isThisYear && i === now.getMonth();
      return `<div class="mcol${isNow ? ' now' : ''}${m.rev || m.up ? '' : ' empty'}" title="${esc(tip)}">
        <div class="mbars">
          ${hasPrev ? `<i class="pbar" style="--h:${h(p.rev)}%"></i>` : ''}
          <div class="stack" style="--h:${h(m.rev + m.up)}%">${m.up ? `<i class="up" style="flex:${m.up}"></i>` : ''}${m.rev ? `<i class="cur" style="flex:${m.rev}"></i>` : ''}${label ? `<em>${label}</em>` : ''}</div>
        </div><div class="mlab">${mName(i, 'short')}</div></div>`;
    }).join('');

    const rows = cur.map((m, i) => {
      const d = hasPrev ? m.rev - prev[i].rev : null;
      return `<tr class="${isThisYear && i === now.getMonth() ? 'nowrow' : ''}"><td>${mName(i, 'long')}</td><td class="n">${m.orders || '—'}</td><td class="n">${m.cookies || '—'}</td>
        <td class="n"><b>${m.rev ? money(m.rev) : '—'}</b></td><td class="n muted">${m.up ? money(m.up) : '—'}</td>
        <td class="n ${d > 0 ? 'ok' : d < 0 ? 'neg' : 'muted'}">${d === null || (!m.rev && !prev[i].rev) ? '—' : (d > 0 ? '+' : d < 0 ? '−' : '') + money(Math.abs(d))}</td></tr>`;
    }).join('');

    return `<div class="panel monthly">
      <div class="mhead"><h3>Revenue by month · ${year}</h3>
        <div class="legend2"><span><i class="sw cur"></i>Collected</span><span><i class="sw up"></i>Still to collect</span>${hasPrev ? `<span><i class="sw pbar"></i>${+year - 1}</span>` : ''}</div></div>
      <div class="sumrow">
        <div><b>${money(total)}</b><span>Collected in ${year}</span></div>
        <div><b class="${change === null ? '' : change >= 0 ? 'ok' : 'neg'}">${change === null ? '—' : (change >= 0 ? '▲ ' : '▼ ') + Math.abs(change) + '%'}</b><span>${isThisYear ? `vs same months of ${+year - 1}` : `vs ${+year - 1}`}</span></div>
        <div><b>${best.rev ? mName(best.i, 'long') : '—'}</b><span>Best month${best.rev ? ' · ' + money(best.rev) : ''}</span></div>
        <div><b>${money(avg)}</b><span>Average per month</span></div>
        ${upTotal ? `<div><b>${money(upTotal)}</b><span>Still to collect on open orders</span></div>` : ''}
      </div>
      <div class="mplot"><div class="mgrid">${ticks.map((t) => `<div style="bottom:${h(t)}%"><span>${short$(t)}</span></div>`).join('')}</div>
        <div class="mcols">${cols}</div></div>
      <p class="muted small">Collected = money received that month, by payment date. Payments with no date count in the order's pickup month. Orders and cookies are counted in the month of pickup.</p>
      <details class="mtable"><summary>Month-by-month table</summary>
        <div class="tablebox"><table class="t"><thead><tr><th>Month</th><th class="n">Orders picked up</th><th class="n">Cookies</th><th class="n">Collected</th><th class="n">Still to collect</th><th class="n">${hasPrev ? `vs ${+year - 1}` : ''}</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><td>Total</td><td class="n">${cur.reduce((a, m) => a + m.orders, 0)}</td><td class="n">${cur.reduce((a, m) => a + m.cookies, 0)}</td><td class="n">${money(total)}</td><td class="n">${money(upTotal)}</td><td></td></tr></tfoot></table></div></details>
    </div>`;
  }

  function viewMoney(main) {
    const ys = yearStats();
    if (!ys.length) { main.innerHTML = '<h2>Money</h2><p class="muted">No completed orders yet.</p>'; return; }
    const cur = S.year && ys.find((r) => r.y == S.year) ? S.year : ys[ys.length - 1].y;
    S.year = cur;
    const row = ys.find((r) => r.y == cur);
    const owing = S.vault.orders.filter((o) => o.status !== 'Declined' && o.amtDue != null && balance(o) > 0.005)
      .sort((a, b) => balance(b) - balance(a));
    const pipeline = S.vault.orders.filter((o) => OPEN.includes(o.status)).reduce((s, o) => s + num(o.amtDue), 0);
    const total = ys.reduce((s, r) => s + r.cash, 0);
    main.innerHTML = `<h2>Money</h2>
      <div class="bar"><label>Year <select id="year">${ys.map((r) => `<option${r.y == cur ? ' selected' : ''}>${r.y}</option>`).join('')}</select></label></div>
      <div class="kpis">
        <div class="kpi"><b>${money(row.cash)}</b><span>Collected in ${cur}</span></div>
        <div class="kpi"><b>${row.orders}</b><span>Orders completed in ${cur}</span></div>
        <div class="kpi"><b>${money(row.orders ? row.rev / row.orders : 0)}</b><span>Average per order</span></div>
        <div class="kpi"><b>${row.cookies.toLocaleString()}</b><span>Cookies made in ${cur}</span></div>
        <div class="kpi"><b>${money(pipeline)}</b><span>Open orders (quoted)</span></div>
        <div class="kpi"><b class="${owing.length ? 'neg' : ''}">${money(owing.reduce((s, o) => s + balance(o), 0))}</b><span>Outstanding balances</span></div>
      </div>
      ${insightsSection()}
      ${monthlySection(cur)}
      ${occasionSection(cur)}
      <div class="panel"><h3>By year</h3><div class="yeargrid">
        <div>${bars(ys.map((r) => ({ l: r.y, v: r.cash })))}<p class="muted small">All time: ${money(total)}. Collected = money received that year. Orders, cookies and average are for orders picked up that year.</p></div>
        <div class="tablebox"><table class="t"><thead><tr><th>Year</th><th class="n">Collected</th><th class="n">Orders</th><th class="n">Cookies</th><th class="n">Avg / order</th><th class="n">Declined</th></tr></thead>
        <tbody>${ys.map((r) => `<tr><td>${r.y}</td><td class="n">${money(r.cash)}</td><td class="n">${r.orders}</td><td class="n">${r.cookies}</td><td class="n">${money(r.orders ? r.rev / r.orders : 0)}</td><td class="n">${r.declined}</td></tr>`).join('')}</tbody></table></div>
      </div></div>
      ${owing.length ? `<h3>Outstanding balances</h3><div class="tablebox"><table class="t"><thead><tr><th>Customer</th><th>Due date</th><th>Status</th><th class="n">Total</th><th class="n">Paid</th><th class="n">Balance</th></tr></thead>
      <tbody>${owing.map((o) => `<tr data-id="${o.id}"><td>${esc(o.name)}</td><td>${esc(fmtDate(o.due))}</td><td>${o.status}</td><td class="n">${money(o.amtDue)}</td><td class="n">${money(o.paid)}</td><td class="n neg">${money(balance(o))}</td></tr>`).join('')}</tbody></table></div>` : ''}`;
  }

  /* ---------- workbook reference ---------- */
  function viewWorkbook(main) {
    const names = Object.keys(S.vault.ref || {}).filter((n) => !/calculator/i.test(n));
    if (!names.length) { main.innerHTML = '<h2>Workbook</h2><p class="muted">No reference sheets were imported (recipes, icing costs, etc.).</p>'; return; }
    if (!names.includes(S.refSheet)) S.refSheet = names[0];
    const rows = S.vault.ref[S.refSheet].filter((r) => r.some((c) => c !== null && c !== ''));
    const cols = rows[0].map((_, i) => rows.some((r) => r[i] !== null && r[i] !== ''));
    const cell = (c) => c === null || c === '' ? '<td></td>'
      : typeof c === 'number' ? `<td class="n">${Number.isInteger(c) ? c : Math.round(c * 100) / 100}</td>` : `<td>${esc(c)}</td>`;
    const isHead = (r) => r.filter((c) => typeof c === 'string').length >= 2 && r.every((c) => typeof c !== 'number');
    main.innerHTML = `<h2>Workbook</h2><p class="muted small">Read-only copy of your recipe and cost sheets. For pricing, use the Calculator tab.</p>
      <div class="bar">${names.map((n) => `<button class="chip" data-ref="${esc(n)}" aria-selected="${n === S.refSheet}">${esc(n)}</button>`).join('')}</div>
      <div class="tablebox"><table class="t ref"><tbody>${rows.map((r) => {
        const kept = r.filter((_, i) => cols[i]);
        return `<tr class="${isHead(r) ? 'rh' : ''}">${kept.map(cell).join('')}</tr>`;
      }).join('')}</tbody></table></div>`;
  }

  /* ---------- calculator ---------- */
  function viewCalculator(main) {
    const p = (S.site && S.site.pricing) || {};
    const st = S.calc || (S.calc = { qty: 24, price: p.perCookie ?? 4.35, colors: p.includedColors ?? 3, rush: false, addOns: 0, cost: 0.27 });
    main.innerHTML = `<h2>Price calculator</h2>
      <div class="panels">
        <form class="panel ef" id="cf" style="padding:14px" novalidate>
          <div class="fgrid">
            <label>How many cookies?<input name="qty" type="number" min="0" step="1" value="${st.qty}"></label>
            <label>Price each ($)<input name="price" type="number" min="0" step="0.01" value="${st.price}"></label>
            <label>How many colors?<input name="colors" type="number" min="1" step="1" value="${st.colors}"></label>
            <label>Add-ons ($)<input name="addOns" type="number" min="0" step="0.01" value="${st.addOns}"></label>
            <label>Your cost per cookie ($)<input name="cost" type="number" min="0" step="0.01" value="${st.cost}"></label>
            <label class="check" style="grid-template-columns:auto 1fr;align-items:end"><input name="rush" type="checkbox"${st.rush ? ' checked' : ''}> Rush order</label>
          </div>
          <p class="muted small">Base price comes from your site settings (${money(p.perCookie ?? 4.35)} each). Change “Price each” to quote a discount. Cost per cookie is about $0.27 from your Cookie Data sheet.</p>
        </form>
        <div class="panel" id="cout" aria-live="polite"></div>
      </div>`;
    const draw = () => {
      const f = $('#cf').elements, pr = (S.site && S.site.pricing) || {};
      Object.assign(st, { qty: num(f.qty.value), price: num(f.price.value), colors: num(f.colors.value) || 1, addOns: num(f.addOns.value), cost: num(f.cost.value), rush: f.rush.checked });
      const rush = st.rush ? Math.ceil(st.qty / 12) * (pr.rushPerDozen ?? 5) : 0;
      const c = calc({ qty: st.qty, price: st.price, numColors: st.colors, rush, addOnsAmt: st.addOns });
      const costTotal = st.qty * st.cost;
      $('#cout').innerHTML = `<h3>Quote</h3>${c.parts.map(([l, a]) => `<div class="hbar" style="grid-template-columns:1fr auto"><span>${esc(l)}</span><span>${money(a)}</span></div>`).join('')}
        <div class="total-row"><span>Charge</span><strong>${money(c.total)}</strong></div>
        <div class="hbar" style="grid-template-columns:1fr auto"><span class="muted">Estimated ingredient cost</span><span>${money(costTotal)}</span></div>
        <div class="hbar" style="grid-template-columns:1fr auto"><span class="muted">Estimated profit before time</span><span><b>${money(c.total - costTotal)}</b></span></div>
        <div class="hbar" style="grid-template-columns:1fr auto"><span class="muted">Per cookie, all-in</span><span>${st.qty ? money(c.total / st.qty) : '—'}</span></div>
        <button class="btn full" id="calc-make" type="button">Create order from this quote</button>`;
      S.calcOut = { qty: st.qty, price: st.price, numColors: st.colors, rush: rush || null, addOnsAmt: st.addOns || null, amtDue: c.total };
    };
    $('#cf').addEventListener('input', draw);
    draw();
  }

  /* ---------- settings ---------- */
  function viewSettings(main) {
    main.innerHTML = `<h2>Settings</h2>
      <div class="panel help"><h3>Saving to GitHub</h3>
        <p>${!tok() ? '<b class="neg">No token on this device — changes are not being saved.</b>'
          : S.authWhy ? `<b class="neg">⚠ A token is saved on this device, but GitHub rejected it.</b></p><p class="tokwhy">${esc(S.authWhy)} Then paste the new or updated token below and press Save token.`
          : '<span class="ok">✓ A token is saved on this device and is working.</span>'}</p>
        <div class="bar"><input class="grow" id="tok" type="password" placeholder="github_pat_…" autocomplete="off">
          <button class="btn small" id="tok-save">Save token</button>
          ${tok() ? '<button class="btn ghost small" id="tok-clear">Remove</button>' : ''}</div>
        <div class="err" id="tok-msg"></div>
        <details><summary>How do I get a token? (one time per device)</summary><ol>
          <li>On GitHub: your profile picture → <b>Settings</b> → <b>Developer settings</b> → <b>Personal access tokens</b> → <b>Fine-grained tokens</b> → <b>Generate new token</b>.</li>
          <li>Repository access: <b>Only select repositories</b> → <code>momscookies</code>.</li>
          <li>Permissions → Repository permissions → <b>Contents: Read and write</b>.</li>
          <li>Set the longest expiration offered, generate, and paste the token above.</li></ol>
          <p class="muted small">The token can only touch this one repository. It stays in this browser only; it is never saved to the site.</p></details></div>
      <div class="panel help" style="margin-top:16px"><h3>Change username / password</h3>
        <div class="bar"><input id="nu" placeholder="Username" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false"><input id="np" type="password" placeholder="New password (12+ chars)" autocomplete="new-password"><button class="btn small" id="pw-save">Change</button></div>
        <div class="err" id="pw-msg"></div></div>
      <div class="panel help" style="margin-top:16px"><h3>Import your Excel workbook</h3>
        <p class="muted small">${plural(S.vault.orders.length, 'order')} ${S.vault.orders.length === 1 ? 'is' : 'are'} in the portal now. Importing reads your .xlsx in this browser (it is not uploaded) and <b>replaces</b> the orders and reference sheets.</p>
        <div class="bar"><input id="imp-file" type="file" accept=".xlsx,.xls" aria-label="Excel workbook to import"><button class="btn small" id="imp-go">Import</button></div>
        <div class="err" id="imp-msg" role="status"></div></div>
      <div class="panel help" style="margin-top:16px"><h3>Security</h3>
        <label class="lockrow">Lock automatically after
          <select id="autolock">${[[5, '5 minutes'], [15, '15 minutes'], [30, '30 minutes'], [60, '1 hour'], [0, 'Never']].map(([v, l]) => `<option value="${v}"${autoLockMins() === v ? ' selected' : ''}>${l} of no use</option>`).join('')}</select></label>
        <ul class="facts" style="margin-top:12px">
          <li>${DATA === STORES.private ? `Your data is stored in your <b>private</b> repository <b>${esc(DATA.repo)}</b>. Nobody else can download it.` : STORES.private ? `Your data will move to your private repository <b>${esc(STORES.private.repo)}</b> the next time it can save.` : 'Your data is stored encrypted in the website repository.'}</li>
          <li>Your GitHub token is stored on this device <b>encrypted with your password</b>, so your other websites cannot use it.</li>
          <li>Saves to GitHub are labeled <b>Cookie Jar portal</b>, not with your email.</li>
          <li>This page only runs its own code. Outside scripts are blocked.</li>
        </ul></div>
      <div class="panel help" style="margin-top:16px"><h3>Appearance</h3>
        <div class="seg" role="group" aria-label="Theme">${[['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) => `<button data-theme-set="${v}" aria-pressed="${themePref() === v}">${l}</button>`).join('')}</div>
        <p class="muted small">Auto follows your phone or computer setting.</p></div>
      <div class="panel help" style="margin-top:16px"><h3>Install as an app</h3>
        ${window.matchMedia('(display-mode: standalone)').matches || navigator.standalone ? '<p class="ok">✓ You are using the installed app.</p>'
          : deferredInstall ? '<button class="btn small" id="install-app">Install app</button>'
          : '<p class="muted small" style="margin:0">Put the portal on your home screen so it opens like an app. On an iPhone or iPad, tap <b>Share</b>, then <b>Add to Home Screen</b>. On Android or a computer, open your browser menu and choose <b>Install app</b> or <b>Add to Home screen</b>.</p>'}</div>
      <div class="panel help" style="margin-top:16px"><h3>Keyboard shortcuts</h3>
        <p class="muted small" style="margin:0"><kbd>/</kbd> search · <kbd>N</kbd> new order · <kbd>Esc</kbd> close a window · <kbd>←</kbd> <kbd>→</kbd> move between photos</p></div>
      <div class="panel help" style="margin-top:16px"><h3>Tidy up text</h3>
        <p class="muted small">Fixes capitalization and extra spaces in names, event names, colors and notes. For example, “baby shower/reveal” becomes “Baby Shower/Reveal”. You can review every change first.</p>
        ${tidyChanges().length ? `<button class="btn ghost small" data-tidytext>Review ${plural(tidyChanges().length, 'change')}</button>` : '<p class="ok">✓ Everything looks tidy.</p>'}</div>
      <div class="panel help" style="margin-top:16px"><h3>Backup</h3>
        <p class="muted small">Download an encrypted copy of your orders and settings (needs your login to open). Photos are stored separately in your repository, also encrypted, so they are not part of this download.</p>
        <button class="btn ghost small" id="backup">Download encrypted backup</button></div>`;
  }

  /* ---------- events ---------- */
  document.addEventListener('click', async (e) => {
    const t = e.target;
    const tabBtn = t.closest('[data-tab]');
    if (tabBtn) { if (tabBtn.tagName === 'A') e.preventDefault(); goTab(tabBtn.dataset.tab); return; }
    if (t.closest('#savestate.bad')) {
      if (t.textContent.includes('Changed elsewhere')) { if (confirm('Reload to get the latest data? Unsaved changes on this device will be lost.')) { S.dirty = false; location.reload(); } }
      else { S.tab = 'settings'; render(); window.scrollTo(0, 0); }
      return;
    }
    if (t.closest('#lock, #lock-more')) { if (S.dirty && !confirm('You have unsaved changes. Lock anyway?')) return; S.dirty = false; location.reload(); return; }
    if (t.closest('[data-new]')) { openEdit(null); return; }
    if (t.closest('[data-tag]')) { openTagger(); return; }
    if (t.closest('[data-dupes]')) { openDupes(); return; }
    const cu = t.closest('[data-cust]');
    if (cu && !t.closest('a') && !t.closest('dialog')) { openCustomer(cu.dataset.cust); return; }
    const cfb = t.closest('[data-cf]'); if (cfb) { S.cf = cfb.dataset.cf; render(); return; }
    const th = t.closest('[data-theme-set]');
    if (th) { try { localStorage.setItem('gcj_theme', th.dataset.themeSet); } catch { /* ignore */ } applyTheme(); render(); return; }
    if (t.id === 'install-app' && deferredInstall) { deferredInstall.prompt(); deferredInstall = null; render(); return; }
    const ov = t.closest('[data-oview]');
    if (ov) { S.oview = ov.dataset.oview; try { localStorage.setItem('gcj_oview', S.oview); } catch { /* ignore */ } render(); return; }
    const cd = t.closest('[data-calday]');
    if (cd) { const [yy, mm] = cd.dataset.calday.split('-').map(Number); S.cal = { y: yy, m: mm - 1 }; S.calDay = cd.dataset.calday; S.tab = 'calendar'; render(); window.scrollTo(0, 0); return; }
    if (t.closest('[data-photoadd]')) { pickPhotos({}); return; }
    const pk = t.closest('[data-pk]');
    if (pk) { S.pKind = pk.dataset.pk; render(); return; }
    if (t.closest('[data-tidytext]')) { openTidyText(); return; }
    if (t.closest('[data-check]')) { openLabelCheck(); return; }
    const osc = t.closest('[data-occscope]');
    if (osc) { S.occScope = osc.dataset.occscope; render(); return; }
    if (t.closest('#calc-make')) { openEdit(null, S.calcOut); return; }
    const nd = t.closest('[data-newdate]');
    if (nd) { openEdit(null, { due: nd.dataset.newdate }); return; }
    const nav = t.closest('[data-cal]');
    if (nav) {
      const now = new Date(), c = S.cal || (S.cal = { y: now.getFullYear(), m: now.getMonth() });
      if (nav.dataset.cal === 'today') { S.cal = { y: now.getFullYear(), m: now.getMonth() }; S.calDay = todayISO(); }
      else { c.m += nav.dataset.cal === 'next' ? 1 : -1; if (c.m < 0) { c.m = 11; c.y--; } if (c.m > 11) { c.m = 0; c.y++; } S.calDay = null; }
      render(); return;
    }
    const chip = t.closest('[data-f]');
    if (chip) { S.filter = chip.dataset.f; render(); return; }
    const ref = t.closest('[data-ref]');
    if (ref) { S.refSheet = ref.dataset.ref; render(); return; }
    const row = t.closest('[data-id]');
    if (!row) { const dc = t.closest('[data-day]'); if (dc) { S.calDay = dc.dataset.day; render(); return; } }
    if (row && !t.closest('select') && !t.closest('a') && !t.closest('#dlg')) { openEdit(row.dataset.id); return; }
    if (t.id === 'tok-save') {
      const v = $('#tok').value.replace(/\s+/g, '');   // phones can add spaces or line breaks when pasting
      if (!v) return;
      if (!/^(github_pat_|ghp_)/.test(v)) { $('#tok-msg').textContent = 'That does not look like a GitHub token. It should start with github_pat_.'; return; }
      const prev = tok();
      await storeToken(v);
      $('#tok-msg').className = 'muted small'; $('#tok-msg').textContent = 'Checking with GitHub…';
      S.authWhy = '';
      if (STORES.private && DATA === STORES.public) {   // first token on this device: move the data to the private repository
        await migrateToPrivate();
        if (S.authWhy && prev && prev !== v) await storeToken(prev);
        render(); return;
      }
      try {
        const g = await ghGet();
        if (!g) { S.sha = undefined; S.dirty = true; await save(); }
        else if (normEnv(g.text) === S.loaded) { S.sha = g.sha; S.dirty = true; await save(); }
        else if (!S.dirty) {
          try { await adoptRemote(g); S.dirty = true; await save(); toast('Loaded the latest data from your other devices.'); }
          catch (e2) { toast(e2.rekeyed ? 'Your login was changed on another device. Lock and log in again with the new username and password.' : 'The latest data could not be read.', { kind: 'bad', ms: 9000 }); }
        } else { S.sha = null; setSave('conflict'); toast('Another device has newer changes than this one, so nothing was overwritten. Tap “Changed elsewhere” to load them.', { kind: 'bad', ms: 10000 }); }
      } catch (e) {
        if (!S.authWhy) S.authWhy = e.status ? authWhy(e.status, DATA.repo) : 'GitHub could not be reached. Check your internet connection and try again.';
        setSave(e.status ? 'auth' : 'error');
      }
      if (S.authWhy && prev && prev !== v) await storeToken(prev); // keep the old one if the new one fails
      if (!S.authWhy && $('#savestate').textContent.includes('Saved')) toast('✓ Token works. Your changes are saving to GitHub.');
      render();
      return;
    }
    if (t.id === 'tok-clear') { await storeToken(''); setSave('local'); render(); return; }
    if (t.id === 'pw-save') {
      const u = $('#nu').value.trim(), p = $('#np').value;
      if (!u || p.length < 12) { $('#pw-msg').textContent = 'Enter a username and a password of 12+ characters.'; return; }
      S.salt = crypto.getRandomValues(new Uint8Array(16));
      S.key = await derive(u, p, S.salt, S.iter);
      await setTokKey(u, p); if (memToken) await storeToken(memToken);   // re-lock the token with the new password
      touch(); $('#pw-msg').textContent = 'Changed. Use the new login next time.'; $('#np').value = '';
      return;
    }
    if (t.id === 'imp-go') {
      const f = $('#imp-file').files[0], msg = $('#imp-msg');
      if (!f) { msg.textContent = 'Choose your .xlsx file first.'; return; }
      if (S.vault.orders.length && !confirm(`Replace the ${plural(S.vault.orders.length, 'order')} in the portal with the workbook's orders? Edits you made here will be lost.`)) return;
      msg.textContent = 'Importing…';
      try {
        const d = await importWorkbook(f);
        S.vault.orders = d.orders; S.vault.ref = d.ref; photos().forEach((ph) => (ph.orderId = null)); touch();
        msg.className = 'ok'; msg.textContent = `Imported ${plural(d.orders.length, 'order')}.`;
        setTimeout(render, 1200);
      } catch (ex) { msg.className = 'err'; msg.textContent = 'Import failed: ' + (ex.message || ex); }
      return;
    }
    if (t.id === 'csv') { exportCsv(); return; }
    if (t.id === 'backup') {
      const blob = new Blob([await seal()], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `portal-backup-${todayISO()}.enc.json`; a.click();
    }
  });
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.sid) setStatus(byId(t.dataset.sid), t.value);
    if (t.id === 'oyear') { S.oyear = t.value; render(); }
    if (t.id === 'osort') { S.sort = t.value; render(); }
    if (t.id === 'year') { S.year = t.value; render(); }
    if (t.id === 'autolock') { try { localStorage.setItem('gcj_autolock', t.value); } catch { /* ignore */ } toast(+t.value ? `The portal will lock after ${t.options[t.selectedIndex].text}.` : 'Auto-lock is off. Remember to press Lock.'); return; }
    if (t.id === 'csort') { S.csort = t.value; drawCustomers(); return; }
    if (t.id === 'p-occ') { S.pOcc = t.value; drawPhotoGrid(); return; }
    if (t.id === 'p-year') { S.pYear = t.value; drawPhotoGrid(); return; }
    if (t.id === 'cal-done') { S.calDone = t.checked; render(); }
    if (t.id === 'cal-month' || t.id === 'cal-year') {
      S.cal = { y: +$('#cal-year').value, m: +$('#cal-month').value }; S.calDay = null; render();
    }
  });
  document.addEventListener('input', (e) => {
    if (e.target.id === 'q') { S.q = e.target.value; drawOrders(); }
    if (e.target.id === 'pq') { S.pq = e.target.value; drawPhotoGrid(); }
    if (e.target.id === 'cq') { S.cq = e.target.value; drawCustomers(); }
  });

  const TABS = ['home', 'orders', 'customers', 'calendar', 'photos', 'money', 'calculator', 'workbook', 'settings', 'more'];
  function goTab(tab, push = true) {
    if (!TABS.includes(tab)) return;
    S.tab = tab;
    if (push && location.hash.slice(1) !== tab) history.pushState(null, '', '#' + tab);
    withTransition(() => { render(); window.scrollTo(0, 0); });
  }
  window.addEventListener('popstate', () => { if (S.vault) goTab(location.hash.slice(1) || 'home', false); });
  // ---------- auto-lock ----------
  const autoLockMins = () => { try { const v = localStorage.getItem('gcj_autolock'); return v === null ? 15 : +v; } catch { return 15; } };
  let lastActive = Date.now();
  ['pointerdown', 'keydown', 'scroll', 'touchstart'].forEach((ev) => window.addEventListener(ev, () => { lastActive = Date.now(); }, { passive: true }));
  async function checkAutoLock() {
    const mins = autoLockMins();
    if (!S.vault || !mins || Date.now() - lastActive < mins * 60000) return;
    if (S.dirty) { if (tok() && navigator.onLine && !saving) await save(); if (S.dirty) return; }   // never lose unsaved work
    try { sessionStorage.setItem('gcj_locked', String(mins)); } catch { /* ignore */ }
    memToken = ''; tokKey = null; S.vault = null; S.key = null; location.reload();
  }
  setInterval(checkAutoLock, 30000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkAutoLock(); });
  let deferredInstall = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e; if (S.vault && S.tab === 'settings') render(); });
  document.addEventListener('keydown', (e) => {
    if (!S.vault || e.metaKey || e.ctrlKey || e.altKey || document.querySelector('dialog[open]')) return;
    if (e.key === 'Enter' && e.target.closest && e.target.closest('[data-cust]')) { openCustomer(e.target.closest('[data-cust]').dataset.cust); return; }
    if (e.target.closest && e.target.closest('input, textarea, select')) return;
    if (e.key === '/') { e.preventDefault(); if (S.tab !== 'orders' && S.tab !== 'photos') { S.tab = 'orders'; render(); } const q = $('#q') || $('#pq'); if (q) q.focus(); }
    else if (e.key === 'n' || e.key === 'N') { e.preventDefault(); openEdit(null); }
  });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { /* offline support is optional */ });

  showGate();
})();
