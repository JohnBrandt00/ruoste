"""Validate the icon theme the way VS Code loads it:
iconPath is resolved RELATIVE TO THE ICON THEME FILE, not the extension root."""
import json, os, sys, pathlib
import pathlib
ROOT = pathlib.Path(__file__).resolve().parent.parent
THEME = str(ROOT / "themes/ruoste-icon-theme.json")
base = os.path.dirname(THEME)
t = json.load(open(THEME))
defs = t["iconDefinitions"]

missing = [f"{k} -> {v['iconPath']}" for k, v in defs.items()
           if not os.path.isfile(os.path.join(base, v["iconPath"]))]
refs = set()
for d in (t, t.get("light", {})):
    for key in ("file","folder","folderExpanded","rootFolder","rootFolderExpanded"):
        if key in d: refs.add(d[key])
    for tbl in ("fileExtensions","fileNames","languageIds","folderNames","folderNamesExpanded"):
        refs.update(d.get(tbl, {}).values())
dangling = sorted(r for r in refs if r not in defs)
orphan   = sorted(k for k in defs if k not in refs)

ok = not (missing or dangling or orphan)
print(f"icon theme      : {THEME.split('/')[-1]}")
print(f"definitions     : {len(defs)}")
print(f"references      : {len(refs)}")
print(f"missing files   : {len(missing)}" + ("" if not missing else f"  e.g. {missing[0]}"))
print(f"dangling refs   : {dangling or 0}")
print(f"orphan defs     : {len(orphan)}")
print("RESULT          :", "PASS" if ok else "FAIL")
sys.exit(0 if ok else 1)
