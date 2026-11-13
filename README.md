# Gina's Cookie Jar

Static site (no build step) for GitHub Pages.

- **Owner portal** (`index.html`, the home page): private order tracking — orders and statuses, calendar, payments/balances, money dashboard, workbook reference sheets.
- `data/site.json`: pricing used by the portal's calculator.

## Pricing settings
`data/site.json`: `pricing.perCookie` (default 4.35), `occasions`, `about`, `phone`, `location`.

## Owner portal
Data is stored **encrypted** in `data/portal.enc.json` (AES-256-GCM; key derived from your username+password with PBKDF2). It is encrypted/decrypted only in your browser and saved to GitHub through the API, so it syncs across devices.

**First time:** open the site home page → choose username + long password → import your `.xlsx` (parsed in your browser, never uploaded) → paste a GitHub token.
**New device:** log in, then add the token in Settings. The token is stored on that device encrypted with your password, so other pages on ant56-arch.github.io cannot use it.

Token: GitHub → Settings → Developer settings → Fine-grained tokens → only repo `momscookies` → Contents: Read and write.

**Photos:** resized in your browser, encrypted with the same key, and saved as `data/photos/*.bin` through the GitHub API (so a token is needed to upload). Photo details (caption, occasion, linked order) live in the encrypted portal data. Deleting a photo removes its files.

**App features:** installable (`manifest.webmanifest`, `icons/`), offline fallback via `sw.js` (network first, cache only when offline), Auto/Light/Dark theme, toasts with Undo, Back-button navigation (`#orders`, `#calendar`, ...), keyboard shortcuts (`/` search, `N` new order).

Forgot the password = the data cannot be recovered (use Settings → Download encrypted backup regularly, and keep the original workbook).

`vendor/xlsx.full.min.js` is SheetJS (Apache-2.0), used for the one-time Excel import.

## Preview locally
```bash
python3 -m http.server 8000
```

## Security
- Orders, customers and photos are encrypted in the browser (AES-256-GCM, PBKDF2-SHA256 600,000 rounds). GitHub only ever holds scrambled data.
- The GitHub token is kept encrypted with your login key on each device and only unlocked in memory after login.
- Saves are committed as "Cookie Jar portal", not your personal email.
- Auto-lock after inactivity (default 15 minutes; Settings → Security).
- Content Security Policy: the page only runs its own scripts (`theme-init.js`, `portal.js`, `vendor/`).
- Because the site is static, there is no limit on password guesses against a downloaded copy: use a long, random passphrase.
