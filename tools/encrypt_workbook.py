#!/usr/bin/env python3
"""Encrypt the business workbook for the private admin page.

Usage:  python3 tools/encrypt_workbook.py Ginas_Cookie_Jar.xlsx
Prompts for the admin username and password, then writes data/private.enc.json.

The plaintext workbook is NEVER written to the repo. The admin page (admin.html)
derives a key from "username:password" (PBKDF2-SHA256) and decrypts in the browser
(AES-256-GCM). Use a LONG password (a passphrase of 4+ random words): anyone can
download the encrypted file, so its strength is the password's strength.
Re-run this script whenever the workbook changes.
"""
import base64
import datetime
import getpass
import json
import os
import sys
from pathlib import Path

import openpyxl
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

ITER = 600_000
OUT = Path(__file__).resolve().parent.parent / "data" / "private.enc.json"


def cell(v):
    if isinstance(v, (datetime.datetime, datetime.date)):
        return v.strftime("%Y-%m-%d")
    return v


def sheets(path):
    out = {}
    for ws in openpyxl.load_workbook(path, data_only=True):
        rows = [[cell(c) for c in r] for r in ws.iter_rows(values_only=True)]
        rows = [r for r in rows if any(c not in (None, "") for c in r)]
        if not rows:
            continue
        width = max(max((i for i, c in enumerate(r) if c not in (None, "")), default=0) for r in rows) + 1
        out[ws.title] = [r[:width] + [None] * (width - len(r)) for r in rows]
    return out


def encrypt(plain: bytes, user: str, password: str):
    salt, iv = os.urandom(16), os.urandom(12)
    key = PBKDF2HMAC(hashes.SHA256(), 32, salt, ITER).derive(f"{user}:{password}".encode())
    ct = AESGCM(key).encrypt(iv, plain, None)
    b = lambda x: base64.b64encode(x).decode()
    return {"v": 1, "iter": ITER, "salt": b(salt), "iv": b(iv), "data": b(ct)}


def main(path):
    user = input("Admin username: ").strip()
    pw = getpass.getpass("Admin password: ")
    if pw != getpass.getpass("Repeat password: "):
        sys.exit("Passwords differ.")
    if len(pw) < 12:
        sys.exit("Use at least 12 characters (a passphrase is best).")
    data = sheets(path)
    blob = encrypt(json.dumps(data, ensure_ascii=False).encode(), user, pw)
    OUT.write_text(json.dumps(blob))
    print(f"Encrypted {len(data)} sheets -> {OUT}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
