# Gina's Cookie Jar

Static site (no build step) for GitHub Pages.

- **Public site** (`index.html`): custom-cookie price estimator + order request via Facebook Messenger.
- **Owner portal** (`admin.html`): private order tracking — orders and statuses, calendar, payments/balances, money dashboard, workbook reference sheets.

## Public site settings
`data/site.json`: `messenger` (Facebook page username → `m.me/<name>`), `pricing.perCookie` (default 4.35), `occasions`, `about`, `phone`, `location`.

## Owner portal
Data is stored **encrypted** in `data/portal.enc.json` (AES-256-GCM; key derived from your username+password with PBKDF2). It is encrypted/decrypted only in your browser and saved to GitHub through the API, so it syncs across devices.

**First time:** open `/admin.html` → choose username + long password → import your `.xlsx` (parsed in your browser, never uploaded) → paste a GitHub token.
**New device:** log in, then add the token in Settings (the token is stored only in that browser).

Token: GitHub → Settings → Developer settings → Fine-grained tokens → only repo `momscookies` → Contents: Read and write.

Forgot the password = the data cannot be recovered (use Settings → Download encrypted backup regularly, and keep the original workbook).

`vendor/xlsx.full.min.js` is SheetJS (Apache-2.0), used for the one-time Excel import.

## Preview locally
```bash
python3 -m http.server 8000
```
