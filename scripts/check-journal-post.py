#!/usr/bin/env python3
"""Gate for automatic journal posts (branches claude/journal-*).

Usage: check-journal-post.py <base-ref>
Passes only if the branch, compared with <base-ref>:
  - adds exactly one new article under web/journal/
  - changes nothing outside the allowed files (journal index, sitemap,
    docs/journal-log.md, and at most two other pages that only gain a link
    to the new article)
  - keeps every JSON-LD block and the sitemap parseable
  - uses none of the claims the owner has not approved
"""
import json
import re
import subprocess
import sys
import xml.dom.minidom

FORBIDDEN = ["conflict-free", "conflict free", "ethical", "responsibly", "recycled",
             "guarantee", "complimentary", "free shipping", "warranty", "certificate"]
ALWAYS_OK = {"web/journal/index.html", "web/sitemap.xml", "docs/journal-log.md"}


def git(*args):
    return subprocess.run(["git", *args], check=True, capture_output=True, text=True).stdout


def fail(msg):
    print(f"FAIL: {msg}")
    sys.exit(1)


base = sys.argv[1]
status = [l.split("\t") for l in git("diff", "--name-status", f"{base}...HEAD").splitlines() if l]
added = [p for s, p, *_ in status if s == "A" and re.fullmatch(r"web/journal/[a-z0-9-]+\.html", p)]
if len(added) != 1:
    fail(f"expected exactly one new web/journal/*.html, got {added}")
article = added[0]
slug_url = "/" + article[len("web/"):]

others = []
for s, p, *_ in status:
    if p == article or p in ALWAYS_OK:
        continue
    if s == "M" and re.fullmatch(r"web/[a-z0-9-]+\.html", p):
        others.append(p)
        continue
    fail(f"file not allowed in a journal post: {s} {p}")
if len(others) > 2:
    fail(f"at most two other pages may gain a link, got {others}")
for p in others:
    diff = git("diff", "-U0", f"{base}...HEAD", "--", p)
    minus = [l[1:] for l in diff.splitlines() if l.startswith("-") and not l.startswith("---")]
    plus = [l[1:] for l in diff.splitlines() if l.startswith("+") and not l.startswith("+++")]
    if len(minus) != 1 or len(plus) != 1 or slug_url not in plus[0]:
        fail(f"{p}: may only change one line, to add a link to {slug_url}")
    # The old line must survive word for word, apart from the inserted sentence.
    if not plus[0].startswith(minus[0].rsplit("</p>", 1)[0]):
        fail(f"{p}: existing text was changed, not just extended")

for p in [article, "web/journal/index.html"]:
    text = open(p, encoding="utf-8").read()
    blocks = re.findall(r'(?s)<script type="application/ld\+json">(.*?)</script>', text)
    if not blocks:
        fail(f"{p}: no JSON-LD")
    for b in blocks:
        try:
            json.loads(b)
        except ValueError as e:
            fail(f"{p}: JSON-LD does not parse ({e})")

xml.dom.minidom.parse("web/sitemap.xml")
if f"https://azoir.co{slug_url}" not in open("web/sitemap.xml", encoding="utf-8").read():
    fail("article missing from sitemap.xml")
if slug_url not in open("web/journal/index.html", encoding="utf-8").read():
    fail("article missing from journal/index.html")

body = open(article, encoding="utf-8").read().lower()
hits = [w for w in FORBIDDEN if w in body]
if hits:
    fail(f"{article}: unapproved claim words {hits}")

print(f"OK: {article}" + (f" (+ links from {', '.join(others)})" if others else ""))
