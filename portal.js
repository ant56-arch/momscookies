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
  const b64e = (u8) => { let s = ''; u8.forEach((b) => (s += String.fromCharCode(b))); return btoa(s); };
  const b64d = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

  const S = {
    key: null, salt: null, iter: 600000, sha: null, vault: null, site: null,
    tab: 'orders', filter: 'Open', q: '', year: null, refSheet: null, dirty: false,
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
      local: ['Not saved online — add token in Settings', 'bad'],
      conflict: ['Changed on another device — reload to avoid losing data', 'bad'],
      auth: ['Token rejected — check Settings', 'bad'], error: ['Save failed — will retry on next change', 'bad'],
    }[state] || ['', ''];
    el.textContent = m[0]; el.className = 'savestate ' + m[1];
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
      out.push({
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
      });
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

  function loginForm(env) {
    $('#gate').innerHTML = `<form id="lf" class="gate">
      <h1>🔒 Owner login</h1>
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
    $('#gate').innerHTML = `<form id="sf" class="gate">
      <h1>Set up your owner portal</h1>
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
    $('#gate').hidden = true; $('#app').hidden = false;
    setSave(state);
    loadSite().then(render);
    render();
  }
  async function loadSite() { if (!S.site) { try { S.site = await fetch('data/site.json').then((r) => r.json()); } catch { /* ignore */ } } }

  /* ---------- tabs ---------- */
  function render() {
    document.querySelectorAll('#tabs button').forEach((b) => b.setAttribute('aria-current', String(b.dataset.tab === S.tab)));
    const main = $('#main');
    ({ orders: viewOrders, calendar: viewCalendar, money: viewMoney, calculator: viewCalculator, workbook: viewWorkbook, settings: viewSettings }[S.tab])(main);
  }

  /* ---------- orders ---------- */
  const balance = (o) => num(o.amtDue) - num(o.paid);
  const byId = (id) => S.vault.orders.find((o) => o.id === id);

  function viewOrders(main) {
    const counts = Object.fromEntries(STATUSES.map((s) => [s, S.vault.orders.filter((o) => o.status === s).length]));
    const chips = [['Open', OPEN.reduce((a, s) => a + counts[s], 0)], ['All', S.vault.orders.length], ...STATUSES.map((s) => [s, counts[s]])];
    main.innerHTML = `<h2>Orders</h2>
      <div class="bar">
        <button class="btn small" data-new>+ New order</button>
        <input class="grow" id="q" type="search" placeholder="Search name, event, notes…" value="${esc(S.q)}">
      </div>
      <div class="bar">${chips.map(([n, c]) => `<button class="chip" data-f="${n}" aria-selected="${S.filter === n}">${n} (${c})</button>`).join('')}</div>
      <div id="list" class="tablebox"></div>`;
    drawList();
  }

  function drawList() {
    const f = S.filter, q = S.q.toLowerCase();
    let list = S.vault.orders.filter((o) => (f === 'All' ? true : f === 'Open' ? OPEN.includes(o.status) : o.status === f));
    if (q) list = list.filter((o) => [o.name, o.event, o.type, o.notes, o.contact, o.reason].join(' ').toLowerCase().includes(q));
    list.sort(f === 'Open'
      ? (a, b) => (a.due || '9999').localeCompare(b.due || '9999')
      : (a, b) => (b.due || b.requested || '').localeCompare(a.due || a.requested || ''));
    $('#list').innerHTML = list.length ? `<table class="t"><thead><tr>
        <th>Due</th><th>Customer</th><th class="hide-sm">Event</th><th class="n hide-sm">Qty</th><th class="n">Total</th><th class="n">Balance</th><th>Status</th>
      </tr></thead><tbody>${list.map((o) => {
        const bal = balance(o);
        return `<tr data-id="${o.id}">
          <td>${esc(fmtDate(o.due)) || '<span class="muted">—</span>'}</td>
          <td>${esc(o.name)}${num(o.rush) > 0 ? ' <span class="pill rush">rush</span>' : ''}</td>
          <td class="hide-sm">${esc(o.event || o.type)}</td>
          <td class="n hide-sm">${o.qty ?? ''}</td>
          <td class="n">${o.amtDue == null ? '' : money(o.amtDue)}</td>
          <td class="n ${bal > 0.005 && o.status !== 'Declined' ? 'neg' : ''}">${o.amtDue == null || o.status === 'Declined' ? '' : money(bal)}</td>
          <td><select data-sid="${o.id}" aria-label="Status">${STATUSES.map((s) => `<option${s === o.status ? ' selected' : ''}>${s}</option>`).join('')}</select>${o.reason ? ` <span class="muted small">${esc(o.reason)}</span>` : ''}</td>
        </tr>`;
      }).join('')}</tbody></table>` : '<p style="padding:16px" class="muted">No orders match.</p>';
  }

  /* ---------- order editor ---------- */
  const FIELDS = [
    ['name', 'Customer', 'text', { req: 1 }], ['contact', 'Phone / email', 'text'],
    ['status', 'Status', 'select', { opts: STATUSES }], ['reason', 'Reason (if declined)', 'text'],
    ['requested', 'Date requested', 'date'], ['due', 'Pickup / due date', 'date'],
    ['event', 'Event', 'text'], ['type', 'Event type', 'text', { list: 'types' }],
    ['qty', '# of cookies', 'number', { step: '1' }], ['price', 'Price each ($)', 'number', { step: '0.01' }],
    ['numColors', '# of colors', 'number', { step: '1' }], ['designs', '# of designs', 'number', { step: '1' }],
    ['rush', 'Rush fee ($)', 'number', { step: '0.01' }], ['addOns', 'Add-ons', 'text'],
    ['addOnsAmt', 'Add-ons amount ($)', 'number', { step: '0.01' }], ['amtDue', 'Amount due ($)', 'number', { step: '0.01' }],
    ['paid', 'Amount paid ($)', 'number', { step: '0.01' }], ['method', 'Payment method', 'text', { list: 'methods' }],
    ['kind', 'Custom / Premade', 'select', { opts: ['', 'Custom', 'Premade'] }], ['colors', 'Special colors', 'text'],
    ['allergies', 'Allergies', 'text'], ['notes', 'Notes', 'textarea', { wide: 1 }],
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

  function openEdit(id) {
    const o = id ? { ...byId(id) } : { status: 'Requested', requested: todayISO() };
    const types = [...new Set(S.vault.orders.map((x) => x.type).filter(Boolean))].sort();
    const dlg = $('#dlg');
    const fld = ([k, label, type, x = {}]) => {
      const v = o[k] ?? '';
      const cls = x.wide ? ' class="wide"' : '';
      if (type === 'select') return `<label${cls}>${label}<select name="${k}">${x.opts.map((s) => `<option${s === v ? ' selected' : ''}>${s}</option>`).join('')}</select></label>`;
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
        <button type="button" class="btn ghost small" id="b-paid">Mark paid in full</button>
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
      for (const [k, , type] of FIELDS) {
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
    $('#b-calc').onclick = () => { const c = showCalc(); ef.elements.amtDue.value = c.total; };
    $('#b-rush').onclick = () => {
      const p = calc(read()).p;
      ef.elements.rush.value = Math.ceil(num(ef.elements.qty.value) / 12) * (p.rushPerDozen ?? 5);
      showCalc();
    };
    $('#b-paid').onclick = () => { ef.elements.paid.value = ef.elements.amtDue.value; };
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
      if (id) Object.assign(byId(id), data);
      else S.vault.orders.push({ id: crypto.randomUUID().slice(0, 8), ...data });
      dlg.close(); touch(); render();
    });
    dlg.showModal();
  }

  /* ---------- calendar ---------- */
  function viewCalendar(main) {
    const today = todayISO();
    const open = S.vault.orders.filter((o) => OPEN.includes(o.status));
    const overdue = open.filter((o) => o.due && o.due < today).sort((a, b) => a.due.localeCompare(b.due));
    const upcoming = open.filter((o) => o.due && o.due >= today).sort((a, b) => a.due.localeCompare(b.due));
    const nodate = open.filter((o) => !o.due);
    const ev = (o) => `<div class="ev" data-id="${o.id}">
      <span class="who">${esc(o.name)}</span><span>${esc(o.event || o.type || '')}</span>
      <span>${o.qty ?? '?'} cookies</span>${num(o.rush) > 0 ? '<span class="pill rush">rush</span>' : ''}
      <span class="pill">${o.status}</span>
      ${balance(o) > 0.005 && o.amtDue != null ? `<span class="neg">${money(balance(o))} due</span>` : ''}</div>`;
    const groups = {};
    upcoming.forEach((o) => (groups[o.due] ||= []).push(o));
    const days = Object.keys(groups).map((d) => {
      const diff = Math.round((new Date(d + 'T00:00') - new Date(today + 'T00:00')) / 864e5);
      const rel = diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : `in ${diff} days`;
      return `<div class="day">${esc(new Date(d + 'T00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }))} <span class="muted small">· ${rel}</span></div>${groups[d].map(ev).join('')}`;
    });
    const cookies = upcoming.reduce((s, o) => s + num(o.qty), 0);
    main.innerHTML = `<h2>Calendar</h2>
      <div class="bar"><button class="btn small" data-new>+ New order</button>
      <span class="muted">${upcoming.length} upcoming · ${cookies} cookies to bake</span></div>
      ${overdue.length ? `<div class="day over">Overdue — past due date but not completed</div>${overdue.map(ev).join('')}` : ''}
      ${days.join('') || '<p class="muted">Nothing scheduled. New orders with a due date show up here.</p>'}
      ${nodate.length ? `<div class="day">No date yet</div>${nodate.map(ev).join('')}` : ''}`;
  }

  /* ---------- money ---------- */
  function yearStats() {
    const years = {};
    const Y = (y) => (years[y] ||= { y, orders: 0, cookies: 0, rev: 0, declined: 0 });
    for (const o of S.vault.orders) {
      if (o.status === 'Completed') {
        const y = (o.due || o.requested || '').slice(0, 4);
        if (y) { const r = Y(y); r.orders++; r.cookies += num(o.qty); r.rev += num(o.paid); }
      } else if (o.status === 'Declined') {
        const y = (o.requested || '').slice(0, 4);
        if (y) Y(y).declined++;
      }
    }
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
  function viewMoney(main) {
    const ys = yearStats();
    if (!ys.length) { main.innerHTML = '<h2>Money</h2><p class="muted">No completed orders yet.</p>'; return; }
    const cur = S.year && ys.find((r) => r.y == S.year) ? S.year : ys[ys.length - 1].y;
    S.year = cur;
    const row = ys.find((r) => r.y == cur);
    const months = Array.from({ length: 12 }, (_, i) => ({ l: new Date(2000, i).toLocaleDateString(undefined, { month: 'short' }), v: 0 }));
    const types = {};
    S.vault.orders.filter((o) => o.status === 'Completed' && (o.due || o.requested || '').startsWith(cur)).forEach((o) => {
      const m = +(o.due || o.requested).slice(5, 7) - 1; if (m >= 0) months[m].v += num(o.paid);
      const t = o.type || 'Other / unset'; types[t] = (types[t] || 0) + num(o.paid);
    });
    const typeRows = Object.entries(types).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const tmax = Math.max(1, ...typeRows.map((t) => t[1]));
    const owing = S.vault.orders.filter((o) => o.status !== 'Declined' && o.amtDue != null && balance(o) > 0.005)
      .sort((a, b) => balance(b) - balance(a));
    const pipeline = S.vault.orders.filter((o) => OPEN.includes(o.status)).reduce((s, o) => s + num(o.amtDue), 0);
    const total = ys.reduce((s, r) => s + r.rev, 0);
    main.innerHTML = `<h2>Money</h2>
      <div class="bar"><label>Year <select id="year">${ys.map((r) => `<option${r.y == cur ? ' selected' : ''}>${r.y}</option>`).join('')}</select></label></div>
      <div class="kpis">
        <div class="kpi"><b>${money(row.rev)}</b><span>Collected in ${cur}</span></div>
        <div class="kpi"><b>${row.orders}</b><span>Orders completed in ${cur}</span></div>
        <div class="kpi"><b>${money(row.orders ? row.rev / row.orders : 0)}</b><span>Average per order</span></div>
        <div class="kpi"><b>${row.cookies.toLocaleString()}</b><span>Cookies made in ${cur}</span></div>
        <div class="kpi"><b>${money(pipeline)}</b><span>Open orders (quoted)</span></div>
        <div class="kpi"><b class="${owing.length ? 'neg' : ''}">${money(owing.reduce((s, o) => s + balance(o), 0))}</b><span>Outstanding balances</span></div>
      </div>
      <div class="panels">
        <div class="panel"><h3>Revenue by year</h3>${bars(ys.map((r) => ({ l: r.y, v: r.rev })))}<p class="muted small">All time: ${money(total)}</p></div>
        <div class="panel"><h3>Revenue by month, ${cur}</h3>${bars(months)}</div>
        <div class="panel"><h3>By occasion, ${cur}</h3>${typeRows.map(([t, v]) => `<div class="hbar"><span>${esc(t)}</span><i style="width:${Math.max(2, v / tmax * 100)}%"></i><span>${money(v)}</span></div>`).join('') || '<span class="muted">No data</span>'}</div>
      </div>
      <h3>Year summary</h3>
      <div class="tablebox"><table class="t"><thead><tr><th>Year</th><th class="n">Collected</th><th class="n">Orders</th><th class="n">Cookies</th><th class="n">Avg / order</th><th class="n">Declined</th></tr></thead>
      <tbody>${ys.map((r) => `<tr><td>${r.y}</td><td class="n">${money(r.rev)}</td><td class="n">${r.orders}</td><td class="n">${r.cookies}</td><td class="n">${money(r.orders ? r.rev / r.orders : 0)}</td><td class="n">${r.declined}</td></tr>`).join('')}</tbody></table></div>
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
          <p class="muted small">Base price comes from your site settings (${money(p.perCookie ?? 4.35)} each). Change "Price each" to quote a discount. Cost per cookie is about $0.27 from your Cookie Data sheet.</p>
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
        <div class="hbar" style="grid-template-columns:1fr auto"><span class="muted">Est. ingredient cost</span><span>${money(costTotal)}</span></div>
        <div class="hbar" style="grid-template-columns:1fr auto"><span class="muted">Est. profit before time</span><span><b>${money(c.total - costTotal)}</b></span></div>
        <div class="hbar" style="grid-template-columns:1fr auto"><span class="muted">Per cookie, all-in</span><span>${st.qty ? money(c.total / st.qty) : '—'}</span></div>`;
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
        <p class="muted small">${S.vault.orders.length} orders are in the portal now. Importing reads your .xlsx in this browser (it is not uploaded) and <b>replaces</b> the orders and reference sheets.</p>
        <div class="bar"><input id="imp-file" type="file" accept=".xlsx,.xls"><button class="btn small" id="imp-go">Import</button></div>
        <div class="err" id="imp-msg" role="status"></div></div>
      <div class="panel help" style="margin-top:16px"><h3>Backup</h3>
        <p class="muted small">Download an encrypted copy of everything (needs your login to open).</p>
        <button class="btn ghost small" id="backup">Download encrypted backup</button></div>`;
  }

  /* ---------- events ---------- */
  document.addEventListener('click', async (e) => {
    const t = e.target;
    if (t.closest('#tabs button')) { S.tab = t.closest('#tabs button').dataset.tab; render(); return; }
    if (t.id === 'lock') { if (S.dirty && !confirm('You have unsaved changes. Lock anyway?')) return; S.dirty = false; location.reload(); return; }
    if (t.closest('[data-new]')) { openEdit(null); return; }
    const chip = t.closest('[data-f]');
    if (chip) { S.filter = chip.dataset.f; render(); return; }
    const ref = t.closest('[data-ref]');
    if (ref) { S.refSheet = ref.dataset.ref; render(); return; }
    const row = t.closest('[data-id]');
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
      if (S.vault.orders.length && !confirm(`Replace the ${S.vault.orders.length} orders in the portal with the workbook's orders? Edits you made here will be lost.`)) return;
      msg.textContent = 'Importing…';
      try {
        const d = await importWorkbook(f);
        S.vault.orders = d.orders; S.vault.ref = d.ref; touch();
        msg.className = 'ok'; msg.textContent = `Imported ${d.orders.length} orders.`;
        setTimeout(render, 1200);
      } catch (ex) { msg.className = 'err'; msg.textContent = 'Import failed: ' + (ex.message || ex); }
      return;
    }
    if (t.id === 'backup') {
      const blob = new Blob([await seal()], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `portal-backup-${todayISO()}.enc.json`; a.click();
    }
  });
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.sid) { byId(t.dataset.sid).status = t.value; touch(); drawList(); }
    if (t.id === 'year') { S.year = t.value; render(); }
  });
  document.addEventListener('input', (e) => { if (e.target.id === 'q') { S.q = e.target.value; drawList(); } });

  showGate();
})();
