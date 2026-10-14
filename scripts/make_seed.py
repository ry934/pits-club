"""Builds the app's demo data and the Supabase seed from a text export of the Google Sheet.

Usage: python3 -I scripts/make_seed.py <sheet-export.txt>
Writes src/data/seed.json and supabase/seed.sql. Rows are kept raw (cleaning happens in the app,
same code for demo data and live data).
"""
import sys, re, json, os
from datetime import datetime

src = sys.argv[1] if len(sys.argv) > 1 else "../mk-sheet-export.txt"
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
lines = open(src, encoding="utf-8").read().splitlines()

rx = re.compile(r"^(\d{2}/\d{2}/\d{4} \d{2}:\d{2}:\d{2}),([^,]*),([^,]*),([^,]*),([^,]*)")
players_rx = re.compile(r"^,(\d+),([^,]+),(Actif|Ancien) ▾,([0-9A-Fa-f]{6}),")
sec = None
rows, players = [], []
for l in lines:
    if l.startswith("## Sheet name:"):
        sec = l.split(":", 1)[1].strip(); continue
    if sec in ("Archive", "Réponses au formulaire 1"):
        m = rx.match(l)
        if not m: continue
        p = [x.strip() for x in m.groups()[1:]]
        if not all(p): continue
        ts = datetime.strptime(m.group(1), "%d/%m/%Y %H:%M:%S")
        rows.append({"ts": ts.strftime("%Y-%m-%dT%H:%M:%S"), "p": p, "src": "archive" if sec == "Archive" else "form"})
    elif sec == "Réglages":
        m = players_rx.match(l)
        if m:
            players.append({"name": m.group(2).strip(), "active": m.group(3) == "Actif", "color": "#" + m.group(5 - 1).upper()})

rows.sort(key=lambda r: r["ts"])
# Same timestamp in Archive and Form = same race (the Sheet already did this)
seen, uniq = set(), []
for r in rows:
    if r["ts"] in seen: continue
    seen.add(r["ts"]); uniq.append(r)

known = {p["name"] for p in players}
for r in uniq:
    for n in r["p"]:
        if n not in known:
            known.add(n); players.append({"name": n, "active": True, "color": "#9AA3B5"})

json.dump({"generatedAt": datetime.now().strftime("%Y-%m-%dT%H:%M:%S"), "players": players,
           "races": [[r["ts"], *r["p"], r["src"][0]] for r in uniq]},
          open(os.path.join(root, "src/data/seed.json"), "w"), ensure_ascii=False, separators=(",", ":"))

def q(s): return "'" + s.replace("'", "''") + "'"
with open(os.path.join(root, "supabase/seed.sql"), "w", encoding="utf-8") as f:
    f.write("-- Historique importé depuis le Google Sheet. À lancer une fois, après la migration.\n")
    f.write("insert into players (name, active, color) values\n")
    f.write(",\n".join(f"  ({q(p['name'])}, {str(p['active']).lower()}, {q(p['color'])})" for p in players))
    f.write("\non conflict (name) do update set active = excluded.active, color = excluded.color;\n\n")
    for i in range(0, len(uniq), 500):
        chunk = uniq[i:i + 500]
        f.write("insert into races (ts, p1, p2, p3, p4, source) values\n")
        f.write(",\n".join(f"  ({q(r['ts'].replace('T', ' '))}, {', '.join(q(x) for x in r['p'])}, {q(r['src'])})" for r in chunk))
        f.write("\non conflict (ts) do nothing;\n\n")
print(f"{len(uniq)} courses, {len(players)} joueurs")
