# Mom's Cookies

A simple static website (no build step) for taking cookie order requests. Hosted on GitHub Pages.

## Edit the content
- `data/site.json` — business name, tagline, about text, email/phone/location/hours.
  **Set `email`** so the "Send order request" button opens an email with the order filled in.
- `data/products.json` — the menu. Generate it from a spreadsheet:

```bash
pip install openpyxl
python3 tools/excel_to_json.py products.xlsx
```

Spreadsheet columns (first row = headers): `name, description, price, unit, category, available, image`.
Put photos in an `images/` folder and set `image` to e.g. `images/choc-chip.jpg`.

## Preview locally
```bash
python3 -m http.server 8000
```

## Publish on GitHub Pages
Repo → Settings → Pages → Deploy from a branch → `main` / root.
