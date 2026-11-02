# Gina's Cookie Jar

Static site (no build step) for GitHub Pages: custom-cookie price estimator + order request via Facebook Messenger, plus a password-protected admin page for the business workbook.

## Edit the site
`data/site.json`:
- `messenger` — your Facebook page username (opens `m.me/<name>`) or a full link. Set this so the button opens Messenger.
- `pricing.perCookie` — base price (default 4.35). Change it any time for discounts; other fees mirror the "Cookie Orders Calculator" sheet.
- `occasions`, `about`, `phone`, `location`.

## Private admin page (`/admin.html`)
The workbook is **never** stored readable in the repo. Encrypt it locally, then commit only the encrypted file:

```bash
pip install openpyxl cryptography
python3 tools/encrypt_workbook.py Ginas_Cookie_Jar.xlsx   # asks for username + password
```

This writes `data/private.enc.json` (AES-256-GCM, key from PBKDF2). The admin page decrypts it in the browser.
Use a long passphrase (12+ characters); anyone can download the encrypted file, so its strength is your password's strength. Re-run whenever the workbook changes. Do not commit the `.xlsx`.

## Preview locally
```bash
python3 -m http.server 8000
```

## Publish
Repo → Settings → Pages → Deploy from a branch → `main` / root.
