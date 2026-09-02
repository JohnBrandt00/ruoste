"""RUOSTE — package integrity. Every path is resolved the way VS Code resolves it:
theme/icon paths from the extension root, iconPath and font src from the THEME FILE's dir."""
import json, os, sys, re, pathlib
import pathlib
ROOT = pathlib.Path(__file__).resolve().parent.parent
EXT = str(ROOT)
fail = []
def chk(cond, msg):
    print(("  ok   " if cond else "  FAIL ") + msg)
    if not cond: fail.append(msg)

pkg = json.load(open(f"{EXT}/package.json"))
c = pkg["contributes"]

print("── manifest paths (relative to extension root)")
for t in c["themes"]:
    chk(os.path.isfile(f"{EXT}/{t['path']}"), f"theme {t['label']:18} -> {t['path']}")
for t in c["iconThemes"] + c["productIconThemes"]:
    chk(os.path.isfile(f"{EXT}/{t['path']}"), f"icons {t['label']:18} -> {t['path']}")
chk(os.path.isfile(f"{EXT}/{pkg['icon']}"), f"marketplace icon      -> {pkg['icon']}")

print("── colour themes")
for t in c["themes"]:
    d = json.load(open(f"{EXT}/{t['path']}"))
    chk(d["name"] == t["label"], f"{t['label']:18} json name matches manifest label")
    chk(len(d["colors"]) > 700 and len(d["tokenColors"]) > 100,
        f"{t['label']:18} {len(d['colors'])} colors / {len(d['tokenColors'])} rules")

print("── file icon theme (iconPath resolved from the theme file's own dir)")
it = c["iconThemes"][0]; base = os.path.dirname(f"{EXT}/{it['path']}")
d = json.load(open(f"{EXT}/{it['path']}"))
missing = [v["iconPath"] for v in d["iconDefinitions"].values()
           if not os.path.isfile(os.path.join(base, v["iconPath"]))]
chk(not missing, f"{len(d['iconDefinitions'])} icon files resolve"
    + (f"  (missing e.g. {missing[0]})" if missing else ""))
refs = set()
for blk in (d, d.get("light", {}), d.get("highContrast", {})):
    for k in ("file","folder","folderExpanded","rootFolder","rootFolderExpanded"):
        if k in blk: refs.add(blk[k])
    for tbl in ("fileExtensions","fileNames","languageIds","folderNames","folderNamesExpanded"):
        refs.update(blk.get(tbl, {}).values())
chk(not (refs - set(d["iconDefinitions"])), "no dangling icon references")
chk(not (set(d["iconDefinitions"]) - refs), "no unreferenced icon definitions")
for blk in ("light", "highContrast"):
    chk(blk in d, f"{blk} variant present")

print("── product icon theme (font src resolved from the theme file's own dir)")
pt = c["productIconThemes"][0]; pbase = os.path.dirname(f"{EXT}/{pt['path']}")
p = json.load(open(f"{EXT}/{pt['path']}"))
for f in p["fonts"]:
    for s in f["src"]:
        chk(os.path.isfile(os.path.join(pbase, s["path"])), f"font file -> {s['path']}")
try:
    from fontTools.ttLib import TTFont
    ttf = TTFont(str(ROOT / "build/phosphor.ttf"))
    cmap = set(ttf.getBestCmap())
    bad = [k for k, v in p["iconDefinitions"].items()
           if int(v["fontCharacter"].lstrip("\\"), 16) not in cmap]
    chk(not bad, f"{len(p['iconDefinitions'])} codicon ids map to real glyphs"
        + (f"  (bad e.g. {bad[0]})" if bad else ""))
except ImportError:
    print("  skip  fontTools not available")

print("── bundled fonts")
fonts = [f for f in os.listdir(f"{EXT}/fonts") if f.endswith(".ttf")]
chk(len(fonts) >= 8, f"{len(fonts)} Geist Mono ttf files bundled")
chk(os.path.isfile(f"{EXT}/fonts/OFL.txt"), "OFL licence included")

print("── extension host")
main = pkg.get("main")
chk(bool(main) and os.path.isfile(f"{EXT}/{main.lstrip('./')}"), f"main entry -> {main}")
srcfiles = []
for root, _dirs, files in os.walk(f"{EXT}/src"):
    for fn in files:
        if fn.endswith(".js"): srcfiles.append(os.path.join(root, fn))
blob = "\n".join(open(f).read() for f in srcfiles)
declared = {cm["command"] for cm in c.get("commands", [])}
# commands are wired either directly or through the cmd() helper in extension.js
wired = set(re.findall(r"(?:registerCommand|\bcmd)\(\s*['\"]([\w.]+)['\"]", blob))
orphan = {d for d in declared if d not in wired and f"'{d}'" not in blob and f'"{d}"' not in blob}
chk(not orphan, f"all {len(declared)} declared commands are wired in src/"
    + (f"  (orphan: {sorted(orphan)})" if orphan else ""))
undeclared = {w for w in wired if w.startswith("ruoste.")} - declared
chk(not undeclared, "no ruoste command wired without being declared"
    + (f"  ({sorted(undeclared)})" if undeclared else ""))
menu_cmds = {m["command"] for grp in c.get("menus", {}).values() for m in grp if "command" in m}
chk(not (menu_cmds - declared), "every menu entry points at a declared command")
for vc in c.get("viewsContainers", {}).get("activitybar", []):
    chk(os.path.isfile(f"{EXT}/{vc['icon']}"), f"activity bar icon -> {vc['icon']}")
view_ids = {v["id"] for grp in c.get("views", {}).values() for v in grp}
welcome  = {w["view"] for w in c.get("viewsWelcome", [])}
chk(not (welcome - view_ids), "viewsWelcome only references declared views")
cfg_keys = list(c.get("configuration", {}).get("properties", {}))
used = set(re.findall(r"get\(\s*['\"]([A-Za-z.]+)['\"]", open(f"{EXT}/src/github/tree.js").read()))
used |= set(re.findall(r"get\(\s*['\"]([A-Za-z.]+)['\"]", open(f"{EXT}/src/github/status.js").read()))
unknown = {u for u in used if f"ruoste.actions.{u}" not in cfg_keys}
chk(not unknown, f"{len(cfg_keys)} settings declared, code reads only declared keys"
    + (f"  (unknown: {sorted(unknown)})" if unknown else ""))

print("\nRESULT:", "PASS" if not fail else f"FAIL ({len(fail)})")
sys.exit(0 if not fail else 1)
