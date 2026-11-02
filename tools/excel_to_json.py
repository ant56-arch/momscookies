#!/usr/bin/env python3
"""Convert the product spreadsheet to data/products.json.

Usage:  python3 tools/excel_to_json.py path/to/products.xlsx

First row must be headers. Recognized columns (case-insensitive; extras ignored):
  name, description, price, unit, category, available, image, id
`available` may be yes/no/true/false/1/0 (blank = yes).
"""
import json
import re
import sys
from pathlib import Path

import openpyxl

OUT = Path(__file__).resolve().parent.parent / "data" / "products.json"


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def main(path):
    ws = openpyxl.load_workbook(path, data_only=True).active
    rows = list(ws.iter_rows(values_only=True))
    headers = [str(h or "").strip().lower() for h in rows[0]]
    products = []
    for row in rows[1:]:
        r = {h: v for h, v in zip(headers, row) if h}
        if not r.get("name"):
            continue
        price = r.get("price")
        if isinstance(price, str):
            price = float(price.replace("$", "").replace(",", "").strip() or 0)
        avail = str(r.get("available", "yes")).strip().lower() not in ("no", "false", "0", "n")
        item = {
            "id": str(r.get("id") or slug(str(r["name"]))),
            "name": str(r["name"]).strip(),
            "description": str(r.get("description") or "").strip(),
            "price": round(float(price or 0), 2),
            "unit": str(r.get("unit") or "").strip(),
            "category": str(r.get("category") or "").strip(),
            "available": avail,
        }
        if r.get("image"):
            item["image"] = str(r["image"]).strip()
        products.append(item)
    OUT.write_text(json.dumps(products, indent=2, ensure_ascii=False) + "\n")
    print(f"Wrote {len(products)} products to {OUT}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
