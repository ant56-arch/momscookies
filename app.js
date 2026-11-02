(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const money = (n) => '$' + Number(n).toFixed(2);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const CART_KEY = 'momscookies-cart-v1';
  let site = {};
  let products = [];
  let category = 'All';
  let cart = {}; // id -> qty

  // ---------- storage ----------
  const loadCart = () => {
    try { cart = JSON.parse(localStorage.getItem(CART_KEY)) || {}; } catch { cart = {}; }
  };
  const saveCart = () => {
    try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch { /* private mode */ }
  };

  // ---------- data ----------
  async function load() {
    const [s, p] = await Promise.all([
      fetch('data/site.json').then((r) => r.json()),
      fetch('data/products.json').then((r) => r.json()),
    ]);
    site = s;
    products = p.map((x, i) => ({ id: x.id ?? String(i), ...x }));
  }

  function applySite() {
    document.title = site.name || document.title;
    $('brand-name').textContent = site.name || '';
    $('footer-name').textContent = site.name || '';
    if (site.tagline) $('tagline').textContent = site.tagline;
    if (site.heroText) $('hero-sub').textContent = site.heroText;
    if (site.about) $('about-text').textContent = site.about;
    $('year').textContent = new Date().getFullYear();

    const items = [];
    if (site.phone) items.push(`📞 <a href="tel:${esc(site.phone)}">${esc(site.phone)}</a>`);
    if (site.email) items.push(`✉️ <a href="mailto:${esc(site.email)}">${esc(site.email)}</a>`);
    if (site.location) items.push(`📍 ${esc(site.location)}`);
    if (site.hours) items.push(`🕒 ${esc(site.hours)}`);
    $('contact-list').innerHTML = items.map((i) => `<li>${i}</li>`).join('');

    $('order-hint').textContent = site.email
      ? 'This opens your email app with the order filled in. Prices are estimates until confirmed.'
      : 'Set "email" in data/site.json to enable sending. For now, use "Copy order text".';
  }

  // ---------- menu ----------
  function renderFilters() {
    const cats = ['All', ...new Set(products.map((p) => p.category).filter(Boolean))];
    const f = $('filters');
    f.hidden = cats.length <= 2;
    f.innerHTML = cats.map((c) =>
      `<button class="chip" role="tab" data-cat="${esc(c)}" aria-selected="${c === category}">${esc(c)}</button>`
    ).join('');
  }

  function renderProducts() {
    const list = products.filter((p) => category === 'All' || p.category === category);
    if (!list.length) { $('products').innerHTML = '<p class="muted">Nothing here yet.</p>'; return; }
    $('products').innerHTML = list.map((p) => {
      const sold = p.available === false;
      const pic = p.image
        ? `<img class="pic" src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy">`
        : `<div class="pic" aria-hidden="true">${esc(p.emoji || '🍪')}</div>`;
      return `<article class="card${sold ? ' sold' : ''}">
        ${pic}
        <div class="body">
          <h3>${esc(p.name)}</h3>
          <p>${esc(p.description)}</p>
          <div class="row">
            <span class="price">${money(p.price)}${p.unit ? ` <small class="muted">/ ${esc(p.unit)}</small>` : ''}</span>
            ${sold ? '<span class="muted small">Sold out</span>'
                   : `<button class="btn" data-add="${esc(p.id)}">Add</button>`}
          </div>
        </div>
      </article>`;
    }).join('');
  }

  // ---------- cart ----------
  const byId = (id) => products.find((p) => p.id === id);
  const lines = () => Object.entries(cart)
    .map(([id, qty]) => ({ p: byId(id), qty }))
    .filter((l) => l.p && l.qty > 0);
  const total = () => lines().reduce((s, l) => s + l.p.price * l.qty, 0);

  function setQty(id, qty) {
    if (qty <= 0) delete cart[id]; else cart[id] = qty;
    saveCart();
    renderCart();
  }

  function renderCart() {
    const ls = lines();
    $('cart-count').textContent = ls.reduce((s, l) => s + l.qty, 0);
    $('cart-total').textContent = money(total());
    $('cart-items').innerHTML = ls.length
      ? ls.map(({ p, qty }) => `<div class="line">
          <strong>${esc(p.name)}</strong><span>${money(p.price * qty)}</span>
          <span class="qty">
            <button data-dec="${esc(p.id)}" aria-label="Fewer">−</button>
            <span>${qty}</span>
            <button data-inc="${esc(p.id)}" aria-label="More">+</button>
          </span>
          <button class="icon-btn" style="font-size:1rem" data-rm="${esc(p.id)}">Remove</button>
        </div>`).join('')
      : '<p class="muted">Your order is empty. Add something from the menu!</p>';
  }

  function orderText(form) {
    const d = new FormData(form);
    const out = [`New order request for ${site.name || 'the shop'}`, ''];
    lines().forEach(({ p, qty }) =>
      out.push(`- ${qty} x ${p.name}${p.unit ? ` (${p.unit})` : ''} — ${money(p.price * qty)}`));
    out.push('', `Estimated total: ${money(total())}`, '');
    out.push(`Name: ${d.get('name') || ''}`, `Contact: ${d.get('contact') || ''}`);
    if (d.get('date')) out.push(`Requested date: ${d.get('date')}`);
    if (d.get('notes')) out.push(`Notes: ${d.get('notes')}`);
    return out.join('\n');
  }

  function toggleDrawer(open) {
    $('drawer').classList.toggle('open', open);
    $('drawer').setAttribute('aria-hidden', String(!open));
    $('overlay').hidden = !open;
  }

  // ---------- events ----------
  function bind() {
    $('filters').addEventListener('click', (e) => {
      const c = e.target.closest('[data-cat]');
      if (!c) return;
      category = c.dataset.cat;
      renderFilters(); renderProducts();
    });
    $('products').addEventListener('click', (e) => {
      const b = e.target.closest('[data-add]');
      if (!b) return;
      setQty(b.dataset.add, (cart[b.dataset.add] || 0) + 1);
      b.textContent = 'Added ✓';
      setTimeout(() => (b.textContent = 'Add'), 900);
    });
    $('cart-items').addEventListener('click', (e) => {
      const t = e.target;
      if (t.dataset.inc) setQty(t.dataset.inc, (cart[t.dataset.inc] || 0) + 1);
      if (t.dataset.dec) setQty(t.dataset.dec, (cart[t.dataset.dec] || 0) - 1);
      if (t.dataset.rm) setQty(t.dataset.rm, 0);
    });
    $('cart-open').addEventListener('click', () => toggleDrawer(true));
    $('cart-close').addEventListener('click', () => toggleDrawer(false));
    $('overlay').addEventListener('click', () => toggleDrawer(false));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') toggleDrawer(false); });

    const form = $('order-form');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!lines().length) { alert('Add at least one item first.'); return; }
      const text = orderText(form);
      if (!site.email) { navigator.clipboard?.writeText(text); alert('No email set up yet — order text copied instead.'); return; }
      location.href = `mailto:${site.email}?subject=${encodeURIComponent('Order request')}&body=${encodeURIComponent(text)}`;
    });
    $('copy-btn').addEventListener('click', async () => {
      if (!lines().length) { alert('Add at least one item first.'); return; }
      const text = orderText(form);
      try { await navigator.clipboard.writeText(text); $('copy-btn').textContent = 'Copied ✓'; }
      catch { prompt('Copy your order:', text); }
      setTimeout(() => ($('copy-btn').textContent = 'Copy order text'), 1500);
    });
  }

  // ---------- init ----------
  (async () => {
    loadCart();
    try {
      await load();
    } catch (err) {
      $('products').innerHTML = '<p class="muted">Could not load the menu. (If you opened index.html directly, run a local server or view the GitHub Pages site.)</p>';
      return;
    }
    // drop cart items that no longer exist
    Object.keys(cart).forEach((id) => { if (!byId(id)) delete cart[id]; });
    applySite(); renderFilters(); renderProducts(); renderCart(); bind();
  })();
})();
