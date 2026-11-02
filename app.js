(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const money = (n) => '$' + n.toFixed(2);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let site = {};

  // Same math as the "Cookie Orders Calculator" sheet.
  function quote(qty, colors, rush, metallic) {
    const p = site.pricing;
    qty = Math.max(0, Math.floor(qty) || 0);
    colors = Math.max(1, Math.floor(colors) || 1);
    const boxes = Math.ceil(qty / p.cookiesPerBox);
    const lines = [];
    const add = (label, amt) => { if (amt) lines.push([label, amt]); };
    add(`${qty} cookies × ${money(p.perCookie)}`, qty * p.perCookie);
    add(`Bags (${qty})`, qty * p.bagPerCookie);
    add(`Gift boxes (${boxes})`, boxes * p.boxPrice);
    add('Ribbon', boxes * p.ribbonPerBox);
    add('Tissue paper', boxes * p.tissuePerBox);
    const extra = Math.max(0, colors - p.includedColors);
    add(`Extra colors (${extra} × ${money(p.extraColorFee)})`, extra * p.extraColorFee);
    if (metallic) add(`Metallic accents (${qty} × ${money(p.metallicPerCookie)})`, qty * p.metallicPerCookie);
    if (rush) add(`Rush fee (${money(p.rushPerDozen)}/dozen)`, Math.ceil(qty / 12) * p.rushPerDozen);
    return { lines, total: lines.reduce((s, l) => s + l[1], 0) };
  }

  const val = (name) => document.forms['order-form'].elements[name];

  function current() {
    const f = val;
    return {
      occasion: f('occasion').value, qty: +f('qty').value, colors: +f('colors').value,
      date: f('date').value, rush: f('rush').checked, metallic: f('metallic').checked,
      allergies: f('allergies').value.trim(), notes: f('notes').value.trim(),
      name: f('name').value.trim(), contact: f('contact').value.trim(),
    };
  }

  function render() {
    const o = current();
    const q = quote(o.qty, o.colors, o.rush, o.metallic);
    $('quote-lines').innerHTML = q.lines.map(([l, a]) => `<div><dt>${esc(l)}</dt><dd>${money(a)}</dd></div>`).join('');
    $('quote-total').textContent = money(q.total);
  }

  function orderText() {
    const o = current();
    const q = quote(o.qty, o.colors, o.rush, o.metallic);
    const t = [`Cookie order request — ${site.name}`, '',
      `Occasion: ${o.occasion}`, `Cookies: ${o.qty}`, `Colors: ${o.colors}`];
    if (o.date) t.push(`Date needed: ${o.date}`);
    if (o.rush) t.push('Rush: yes');
    if (o.metallic) t.push('Metallic accents: yes');
    if (o.allergies) t.push(`Allergies: ${o.allergies}`);
    if (o.notes) t.push(`Ideas/notes: ${o.notes}`);
    t.push('', `Estimated total: ${money(q.total)}`, '', `Name: ${o.name}`, `Contact: ${o.contact}`);
    return t.join('\n');
  }

  async function send() {
    const form = document.forms['order-form'];
    if (!form.reportValidity()) return;
    const text = orderText();
    let copied = true;
    try { await navigator.clipboard.writeText(text); } catch { copied = false; }
    if (site.messenger) {
      const url = /^https?:/.test(site.messenger) ? site.messenger : `https://m.me/${site.messenger}`;
      window.open(url, '_blank', 'noopener');
      $('send-hint').textContent = copied
        ? 'Your request is copied — paste it into the Messenger chat and hit send.'
        : 'Messenger opened. Please type your request there.';
    } else {
      $('send-hint').textContent = copied ? 'Request copied to your clipboard.' : 'Copy this request:\n' + text;
    }
  }

  function applySite() {
    document.title = site.name;
    document.querySelectorAll('[data-site]').forEach((el) => { if (site[el.dataset.site]) el.textContent = site[el.dataset.site]; });
    $('year').textContent = new Date().getFullYear();
    $('gallery').innerHTML = site.occasions.map((o) =>
      `<article class="card"><div class="pic" aria-hidden="true">${esc(o.emoji)}</div><div class="body"><h3>${esc(o.name)}</h3></div></article>`).join('');
    $('occasion').innerHTML = site.occasions.map((o) => `<option>${esc(o.name)}</option>`).join('');
    const p = site.pricing;
    $('rush-label').textContent = `Rush order (+${money(p.rushPerDozen)}/dozen)`;
    $('metallic-label').textContent = `Gold / silver accents (+${money(p.metallicPerCookie)} each)`;
    $('quote-note').textContent = `${p.includedColors} colors included; each extra color is ${money(p.extraColorFee)}. Includes bag, gift box, ribbon and tissue. Estimates only — your final quote is confirmed with you.`;
    const items = [];
    if (site.phone) items.push(`📞 <a href="tel:${esc(site.phone)}">${esc(site.phone)}</a>`);
    if (site.messenger) items.push(`💬 <a href="${esc(/^https?:/.test(site.messenger) ? site.messenger : 'https://m.me/' + site.messenger)}" target="_blank" rel="noopener">Message us on Facebook</a>`);
    if (site.location) items.push(`📍 ${esc(site.location)}`);
    $('contact-list').innerHTML = items.map((i) => `<li>${i}</li>`).join('');
    const d = $('date'); d.min = new Date().toISOString().slice(0, 10);
  }

  fetch('data/site.json').then((r) => r.json()).then((s) => {
    site = s; applySite(); render();
    document.forms['order-form'].addEventListener('input', render);
    document.forms['order-form'].addEventListener('submit', (e) => e.preventDefault());
    $('send-btn').addEventListener('click', send);
  }).catch(() => { document.querySelector('.hero p').textContent = 'Could not load site data. If you opened this page directly from a file, use the published site or a local server.'; });
})();
