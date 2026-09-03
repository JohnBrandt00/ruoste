import json, pathlib
from producticons import MAP

ROOT = pathlib.Path(__file__).resolve().parent.parent
p = ROOT / "build" / "producticons.json"
with open(p, "w") as f:
    json.dump(MAP, f, ensure_ascii=False)
print(f"{len(MAP)} codicon ids -> {len(set(MAP.values()))} phosphor glyphs  ->  {p.name}")
