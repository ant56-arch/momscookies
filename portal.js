(() => {
  'use strict';

  /* ---------- config & helpers ---------- */
  const CFG = { owner: 'ant56-arch', repo: 'momscookies', branch: 'main', path: 'data/portal.enc.json' };
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
  const TEXT_FIELDS = { name: fixName, event: fixEvent, colors: fixSentence, allergies: fixSentence, addOns: fixSentence, notes: fixSentence, reason: fixReason, contact: tidySpace };
  const TEXT_LABELS = { name: 'Name', event: 'Event', colors: 'Colors', allergies: 'Allergies', addOns: 'Add-ons', notes: 'Notes', reason: 'Reason', contact: 'Contact' };
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
  const b64e = (u8) => { let s = ''; u8.forEach((b) => (s += String.fromCharCode(b))); return btoa(s); };
  const b64d = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

  const S = {
    key: null, salt: null, iter: 600000, sha: null, vault: null, site: null,
    tab: 'home', filter: 'Orders', oyear: 'All', sort: 'newest', q: '', year: null, refSheet: null, dirty: false,
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
  }

  /* ---------- GitHub storage ---------- */
  const tok = () => { try { return localStorage.getItem('gcj_token') || ''; } catch { return ''; } };
  const api = `https://api.github.com/repos/${CFG.owner}/${CFG.repo}/contents/${CFG.path}`;
  const hdr = () => ({ Authorization: `Bearer ${tok()}`, Accept: 'application/vnd.github+json' });
  async function ghGet() {
    const r = await fetch(`${api}?ref=${CFG.branch}&t=${Date.now()}`, { headers: hdr(), cache: 'no-store' });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error('GitHub ' + r.status);
    const j = await r.json();
    if (!j.content) throw new Error('File too large for API');
    return { sha: j.sha, text: atob(j.content.replace(/\n/g, '')) };
  }
  async function ghPut(text, sha) {
    const body = { message: 'Update portal data', content: btoa(text), branch: CFG.branch };
    if (sha) body.sha = sha;
    const r = await fetch(api, { method: 'PUT', headers: { ...hdr(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (r.status === 409 || r.status === 422) throw Object.assign(new Error('conflict'), { conflict: true });
    if (r.status === 401 || r.status === 403 || r.status === 404) throw Object.assign(new Error('auth'), { auth: true });
    if (!r.ok) throw new Error('GitHub ' + r.status);
    return (await r.json()).content.sha;
  }
  async function fetchEnvelope() {
    if (tok()) {
      try {
        const g = await ghGet();
        if (!g) return null;
        S.sha = g.sha;
        return JSON.parse(g.text);
      } catch { /* fall back to the published copy */ }
    }
    const r = await fetch('data/portal.enc.json', { cache: 'no-store' });
    if (!r.ok) return null;
    S.sha = null;
    return r.json();
  }

  let saving = false, again = false, timer = null;
  function setSave(state) {
    const el = $('#savestate'); if (!el) return;
    const m = {
      saved: ['Saved ✓', ''], saving: ['Saving…', ''], dirty: ['Unsaved changes…', ''],
      local: ['⚠ Not saved', 'bad'],
      conflict: ['⚠ Changed elsewhere', 'bad'],
      auth: ['⚠ Token rejected', 'bad'], error: ['⚠ Save failed', 'bad'],
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
    if (saving) { again = true; return; }
    saving = true; setSave('saving');
    try {
      const text = await seal();
      if (!S.sha) { const g = await ghGet(); S.sha = g ? g.sha : undefined; }
      S.sha = await ghPut(text, S.sha);
      S.dirty = false; setSave('saved');
    } catch (e) {
      setSave(e.conflict ? 'conflict' : e.auth ? 'auth' : 'error');
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
    try { S.site = await fetch('data/site.json').then((r) => r.json()); } catch { S.site = null; }
    let env = null;
    try { env = await fetchEnvelope(); } catch { /* treated as none */ }
    env ? loginForm(env) : setupForm();
  }

  const brandBlock = () => `<div class="gate-brand"><svg class="jar" aria-hidden="true"><use href="#i-jar"/></svg>
      <div class="brand-name">Gina's Cookie Jar</div><div class="muted">Owner portal</div></div>`;

  function loginForm(env) {
    $('#gate').innerHTML = `<form id="lf" class="gate-card">${brandBlock()}
      <h1>Welcome back</h1>
      <label>Username<input id="u" autocomplete="username" required></label>
      <label>Password<input id="p" type="password" autocomplete="current-password" required></label>
      <button class="btn full" type="submit">Unlock</button>
      <div class="err" id="err" role="alert"></div>
      <p class="muted small">Your data is encrypted; it's only decrypted in this browser.</p></form>`;
    $('#lf').addEventListener('submit', async (e) => {
      e.preventDefault();
      $('#err').textContent = '';
      try { await open(env, $('#u').value.trim(), $('#p').value); }
      catch { $('#err').textContent = 'Wrong username or password.'; return; }
      enterApp(tok() ? 'saved' : 'local');
    });
  }

  function setupForm() {
    $('#gate').innerHTML = `<form id="sf" class="gate-card">${brandBlock()}
      <h1>Set up your portal</h1>
      <p class="muted small">No data exists yet. Choose a login and (optionally) import your Excel workbook. Everything is encrypted before it is saved.</p>
      <label>Username<input id="u" autocomplete="username" required></label>
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
        if (t) { try { localStorage.setItem('gcj_token', t); } catch { /* ignore */ } }
        S.sha = null; S.dirty = true;
        enterApp(tok() ? 'dirty' : 'local');
        if (tok()) save();
      } catch (ex) { err(ex.message || 'Setup failed.'); }
    });
  }

  function enterApp(state) {
    $('#gate').hidden = true; $('#app').hidden = false; window.scrollTo(0, 0);
    setSave(state);
    loadSite().then(render);
    render();
    requestAnimationFrame(() => window.scrollTo(0, 0));
  }
  async function loadSite() { if (!S.site) { try { S.site = await fetch('data/site.json').then((r) => r.json()); } catch { /* ignore */ } } }

  /* ---------- tabs ---------- */
  function render() {
    const moreSet = ['more', 'calculator', 'workbook', 'settings'];
    document.querySelectorAll('#tabs button').forEach((b) => b.setAttribute('aria-current', String(b.dataset.tab === S.tab)));
    document.querySelectorAll('#bottomnav button').forEach((b) => b.setAttribute('aria-current', String(b.dataset.tab === S.tab || (b.dataset.tab === 'more' && moreSet.includes(S.tab)))));
    const main = $('#main');
    const views = { home: viewHome, more: viewMore, orders: viewOrders, calendar: viewCalendar, money: viewMoney, calculator: viewCalculator, workbook: viewWorkbook, settings: viewSettings };
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
    main.innerHTML = `<h2>Orders</h2>
      <div class="kpis">
        <div class="kpi"><b>${active.length}</b><span>Active orders</span></div>
        <div class="kpi"><b>${active.reduce((s, o) => s + num(o.qty), 0).toLocaleString()}</b><span>Cookies to bake</span></div>
        <div class="kpi"><b class="${owed.length ? 'neg' : ''}">${money(owed.reduce((s, o) => s + balance(o), 0))}</b><span>Owed to you (${owed.length})</span></div>
        <div class="kpi"><b style="font-size:1.05rem">${next ? esc(fmtDate(next.due)) : '—'}</b><span>${next ? 'Next: ' + esc(short(next.name)) : 'No upcoming pickups'}</span></div>
      </div>
      <div class="bar">
        <button class="btn small" data-new>+ New order</button>
        <input class="grow" id="q" type="search" placeholder="Search name, event, notes, payment…" value="${esc(S.q)}">
      </div>
      <div class="bar">
        ${chip('Orders', 'Orders', orders.length - count('Declined'))}${chip('Active', 'Active', active.length)}${chip('Owes', 'Owes money', owed.length)}${chip('Completed', 'Completed', count('Completed'))}${chip('Declined', 'Declined', count('Declined'))}${chip('NoOcc', 'No occasion', orders.filter(noOcc).length)}
        <span class="sp"></span>
        <select id="oyear" aria-label="Year"><option value="All">All years</option>${years.map((y) => `<option${S.oyear === y ? ' selected' : ''}>${y}</option>`).join('')}</select>
        <select id="osort" aria-label="Sort">${[['newest', 'Newest first'], ['oldest', 'Oldest first'], ['due', 'Due date'], ['total', 'Highest total'], ['name', 'Customer A–Z']].map(([v, l]) => `<option value="${v}"${S.sort === v ? ' selected' : ''}>${l}</option>`).join('')}</select>
        <button class="btn ghost small" id="csv" type="button" title="Download the orders shown as a spreadsheet">Export CSV</button>
      </div>
      <div id="list" class="olist"></div>
      ${S.filter === 'Orders' ? `<p class="muted small">${count('Declined')} cancelled / no-order inquiries are hidden — see the Declined filter.</p>` : ''}`;
    drawList();
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
      if (q && ![o.name, o.event, o.type, o.notes, o.contact, o.reason, o.method, o.colors].join(' ').toLowerCase().includes(q)) return false;
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
      <span class="c-name"><b>${esc(o.name)}</b>${num(o.rush) > 0 ? ' <span class="pill rush">⚡ Rush</span>' : ''}${o.allergies ? ` <span class="pill warn" title="${esc(o.allergies)}">⚠ ${esc(o.allergies)}</span>` : ''}
        <small>${esc(dec ? o.reason : (o.event || o.type))}</small></span>
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
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
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
    ['name', 'Customer', 'text', { req: 1 }], ['contact', 'Phone or email', 'text'],
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
    const o = id ? { ...byId(id) } : { status: 'Requested', requested: todayISO(), ...(prefill || {}) };
    const types = [...new Set(S.vault.orders.map((x) => x.type).filter(Boolean))].sort();
    const dlg = $('#dlg');
    const fld = ([k, label, type, x = {}]) => {
      if (k === '#') return `<h3 class="fh">${label}</h3>`;
      if (x.hide) return '';
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
        if (k === '#' || k === '@pay' || x.hide) continue;
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
    $('#b-cancel').onclick = () => dlg.close();
    if (id) $('#b-del').onclick = () => {
      if (!confirm(`Delete the order for ${o.name}? This can't be undone.`)) return;
      S.vault.orders = S.vault.orders.filter((x) => x.id !== id);
      dlg.close(); touch(); render();
    };
    ef.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!ef.elements.name.value.trim()) { ef.elements.name.focus(); return; }
      const data = read();
      for (const [f, fn] of Object.entries(TEXT_FIELDS)) if (typeof data[f] === 'string') data[f] = fn(data[f]);
      let ord;
      if (id) { ord = byId(id); Object.assign(ord, data); }
      else { ord = { id: crypto.randomUUID().slice(0, 8), ...data }; S.vault.orders.push(ord); }
      if (payTouched || !id) applyPays(ord);
      dlg.close(); touch(); render();
    });
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
    main.innerHTML = `<section class="hero-card">
        <div><h2>${greet}! 🍪</h2>
          <p>${week.length ? `<b>${week.length}</b> pickup${week.length === 1 ? '' : 's'} in the next 7 days · <b>${week.reduce((s, o) => s + num(o.qty), 0)}</b> ${week.reduce((s, o) => s + num(o.qty), 0) === 1 ? 'cookie' : 'cookies'} to bake` : 'Nothing due in the next 7 days.'}</p></div>
        <div class="qa"><button class="btn" data-new>+ New order</button><button class="btn ghost" data-tab="calculator">Calculator</button><button class="btn ghost" data-tab="calendar">Calendar</button></div>
      </section>
      <div class="kpis">
        <div class="kpi"><b>${active.length}</b><span>Active orders</span></div>
        <div class="kpi"><b class="${owed.length ? 'neg' : ''}">${money(owed.reduce((s, o) => s + balance(o), 0))}</b><span>Owed to you (${owed.length})</span></div>
        <div class="kpi"><b>${money(sumPaid(today.slice(0, 7)))}</b><span>Collected in ${now.toLocaleDateString(undefined, { month: 'long' })}</span></div>
        <div class="kpi"><b>${money(sumPaid(today.slice(0, 4)))}</b><span>Collected in ${now.getFullYear()}</span></div>
      </div>
      <div class="panels">
        <div class="panel"><h3>Coming up</h3>
          ${upcoming.length ? upcoming.slice(0, 6).map(evRow).join('') : '<p class="muted">No upcoming pickups. Add an order to get started.</p>'}
          ${upcoming.length > 6 ? '<button class="btn ghost small" data-tab="calendar">See all in calendar</button>' : ''}</div>
        <div class="panel"><h3>Needs attention</h3>
          ${attention.length ? `<div class="sub">Overdue or no date</div>${attention.slice(0, 5).map(evRow).join('')}` : ''}
          ${owed.length ? `<div class="sub">Balances owed</div>${owed.slice(0, 5).map(evRow).join('')}` : ''}
          ${!attention.length && !owed.length ? '<p class="muted">All caught up. 🎉</p>' : ''}</div>
      </div>
      <div class="panel"><h3>Collected, last 6 months</h3>${bars(months)}</div>`;
  }

  function viewMore(main) {
    const card = (tab, icon, title, text) => `<button class="linkcard" data-tab="${tab}"><span class="emo">${icon}</span><b>${title}</b><span class="muted">${text}</span></button>`;
    main.innerHTML = `<h2>More</h2><div class="linkcards">
      ${card('calculator', '🧮', 'Price calculator', 'Quote a set of cookies')}
      ${card('workbook', '📒', 'Workbook', 'Recipe and cost sheets')}
      ${card('settings', '⚙️', 'Settings', 'Saving, password, import, backup')}
      <button class="linkcard" id="lock-more"><span class="emo">🔒</span><b>Lock</b><span class="muted">Sign out on this device</span></button></div>`;
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
        <h2>${first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h2>
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
    const W = Math.max(320, items.length * 54), H = 190, pad = 28, max = Math.max(1, ...items.map((i) => i.v));
    const slot = (W - 20) / items.length, bw = Math.min(38, slot - 8);
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Bar chart">${items.map((it, i) => {
      const h = (H - pad * 2) * it.v / max, x = 10 + i * slot + (slot - bw) / 2, y = H - pad - h;
      return `<rect x="${x}" y="${y}" width="${bw}" height="${h}" rx="4" fill="var(--accent)"/>
        <text class="bv" x="${x + bw / 2}" y="${y - 5}">${it.v ? fmt(it.v) : ''}</text>
        <text x="${x + bw / 2}" y="${H - 9}">${esc(it.l)}</text>`;
    }).join('')}</svg>`;
  }
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
        <p>${tok() ? '<span class="ok">✓ A token is saved on this device.</span>' : '<b class="neg">No token on this device — changes are not being saved.</b>'}</p>
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
        <div class="bar"><input id="nu" placeholder="Username" autocomplete="username"><input id="np" type="password" placeholder="New password (12+ chars)" autocomplete="new-password"><button class="btn small" id="pw-save">Change</button></div>
        <div class="err" id="pw-msg"></div></div>
      <div class="panel help" style="margin-top:16px"><h3>Import your Excel workbook</h3>
        <p class="muted small">${plural(S.vault.orders.length, 'order')} ${S.vault.orders.length === 1 ? 'is' : 'are'} in the portal now. Importing reads your .xlsx in this browser (it is not uploaded) and <b>replaces</b> the orders and reference sheets.</p>
        <div class="bar"><input id="imp-file" type="file" accept=".xlsx,.xls"><button class="btn small" id="imp-go">Import</button></div>
        <div class="err" id="imp-msg" role="status"></div></div>
      <div class="panel help" style="margin-top:16px"><h3>Tidy up text</h3>
        <p class="muted small">Fixes capitalization and extra spaces in names, event names, colors and notes. For example, “baby shower/reveal” becomes “Baby Shower/Reveal”. You can review every change first.</p>
        ${tidyChanges().length ? `<button class="btn ghost small" data-tidytext>Review ${plural(tidyChanges().length, 'change')}</button>` : '<p class="ok">✓ Everything looks tidy.</p>'}</div>
      <div class="panel help" style="margin-top:16px"><h3>Backup</h3>
        <p class="muted small">Download an encrypted copy of everything (needs your login to open).</p>
        <button class="btn ghost small" id="backup">Download encrypted backup</button></div>`;
  }

  /* ---------- events ---------- */
  document.addEventListener('click', async (e) => {
    const t = e.target;
    const tabBtn = t.closest('[data-tab]');
    if (tabBtn) { S.tab = tabBtn.dataset.tab; render(); window.scrollTo(0, 0); return; }
    if (t.closest('#savestate.bad')) {
      if (t.textContent.includes('Changed elsewhere')) { if (confirm('Reload to get the latest data? Unsaved changes on this device will be lost.')) { S.dirty = false; location.reload(); } }
      else { S.tab = 'settings'; render(); window.scrollTo(0, 0); }
      return;
    }
    if (t.id === 'lock' || t.closest('#lock-more')) { if (S.dirty && !confirm('You have unsaved changes. Lock anyway?')) return; S.dirty = false; location.reload(); return; }
    if (t.closest('[data-new]')) { openEdit(null); return; }
    if (t.closest('[data-tag]')) { openTagger(); return; }
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
    if (row && !t.closest('select') && !t.closest('#dlg')) { openEdit(row.dataset.id); return; }
    if (t.id === 'tok-save') {
      const v = $('#tok').value.trim(); if (!v) return;
      try { localStorage.setItem('gcj_token', v); } catch { /* ignore */ }
      $('#tok-msg').textContent = 'Checking…';
      try {
        const g = await ghGet();
        if (g) { S.sha = g.sha; if (!S.dirty && !S.vault) S.vault = JSON.parse(g.text); } else S.sha = undefined;
        S.dirty = true; await save(); render();
      } catch { $('#tok-msg').textContent = 'That token did not work. Check it has Contents read/write on momscookies.'; }
      return;
    }
    if (t.id === 'tok-clear') { try { localStorage.removeItem('gcj_token'); } catch { /* ignore */ } setSave('local'); render(); return; }
    if (t.id === 'pw-save') {
      const u = $('#nu').value.trim(), p = $('#np').value;
      if (!u || p.length < 12) { $('#pw-msg').textContent = 'Enter a username and a password of 12+ characters.'; return; }
      S.salt = crypto.getRandomValues(new Uint8Array(16));
      S.key = await derive(u, p, S.salt, S.iter);
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
        S.vault.orders = d.orders; S.vault.ref = d.ref; touch();
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
    if (t.dataset.sid) { byId(t.dataset.sid).status = t.value; touch(); render(); }
    if (t.id === 'oyear') { S.oyear = t.value; render(); }
    if (t.id === 'osort') { S.sort = t.value; render(); }
    if (t.id === 'year') { S.year = t.value; render(); }
    if (t.id === 'cal-done') { S.calDone = t.checked; render(); }
  });
  document.addEventListener('input', (e) => { if (e.target.id === 'q') { S.q = e.target.value; drawList(); } });

  showGate();
})();
