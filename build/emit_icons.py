import json, os, sys, pathlib
from palette import DARK, LIGHT, CONTRAST
from iconspec import FILES, FOLDERS
import icongen
import pathlib
ROOT = pathlib.Path(__file__).resolve().parent.parent

ROLE = lambda P: {"rust":P["rust"], "ochre":P["ochre"], "verd":P["verdigris"],
                  "blue":P["blueprint"], "moss":P["moss"], "madder":P["madder"],
                  "mute":P["mute"], "dim":P["dim"], "fg":P["fg"]}

EXT = str(ROOT)
defs, n = {}, 0

def emit(key, suffix, render):
    """render(color, outname) for both modes; returns (darkKey, lightKey)"""
    global n
    out = {}
    for P, s in MODES:
        name = f"{key}_{s}"
        render(P, name)
        defs[f"_{name}"] = {"iconPath": f"../icons/{name}.svg"}
        out[s] = f"_{name}"
        n += 1
    return out["d"], out["l"], out["c"]

MODES = ((DARK,"d"), (LIGHT,"l"), (CONTRAST,"c"))
TABLES = ("fileExtensions","fileNames","languageIds","folderNames","folderNamesExpanded")
D, L, H = {}, {}, {}
for tbl in TABLES:
    D[tbl], L[tbl], H[tbl] = {}, {}, {}

# ── files ────────────────────────────────────────────────────────────────
for key, ph, role, exts, names, langs in FILES:
    d, l, h = emit(f"f_{key}", None,
        lambda P, out, ph=ph, role=role: icongen.file_icon(ph, ROLE(P)[role], out))
    for e in exts:  D["fileExtensions"][e]=d; L["fileExtensions"][e]=l; H["fileExtensions"][e]=h
    for f in names: D["fileNames"][f]=d;      L["fileNames"][f]=l;      H["fileNames"][f]=h
    for g in langs: D["languageIds"][g]=d;    L["languageIds"][g]=l;    H["languageIds"][g]=h

# ── folders (closed + expanded) ──────────────────────────────────────────
for key, glyph, role, names in FOLDERS:
    d, l, h = emit(f"o_{key}", None,
        lambda P, out, g=glyph, role=role: icongen.folder_icon(ROLE(P)[role], out, glyph=g))
    de, le, he = emit(f"o_{key}_x", None,
        lambda P, out, g=glyph, role=role: icongen.folder_icon(ROLE(P)[role], out, glyph=g,
                                                               shell="folder-open"))
    for f in names:
        D["folderNames"][f]=d;          L["folderNames"][f]=l;          H["folderNames"][f]=h
        D["folderNamesExpanded"][f]=de; L["folderNamesExpanded"][f]=le; H["folderNamesExpanded"][f]=he

# ── defaults ─────────────────────────────────────────────────────────────
f_d,  f_l,  f_h  = emit("f_default", None, lambda P,o: icongen.file_icon("file", ROLE(P)["mute"], o))
fo_d, fo_l, fo_h = emit("o_default", None, lambda P,o: icongen.folder_icon(ROLE(P)["mute"], o))
fx_d, fx_l, fx_h = emit("o_default_x", None,
                  lambda P,o: icongen.folder_icon(ROLE(P)["mute"], o, shell="folder-open"))
r_d,  r_l,  r_h  = emit("o_root", None,
                  lambda P,o: icongen.folder_icon(ROLE(P)["rust"], o, shell="folder-simple"))
rx_d, rx_l, rx_h = emit("o_root_x", None,
                  lambda P,o: icongen.folder_icon(ROLE(P)["rust"], o, shell="folder-open"))

theme = {
  "$schema": "vscode://schemas/icon-theme",
  "hidesExplorerArrows": False,
  "showLanguageModeIcons": True,
  "iconDefinitions": defs,
  "file": f_d, "folder": fo_d, "folderExpanded": fx_d,
  "rootFolder": r_d, "rootFolderExpanded": rx_d,
  **D,
  "light": {"file": f_l, "folder": fo_l, "folderExpanded": fx_l,
            "rootFolder": r_l, "rootFolderExpanded": rx_l, **L},
  "highContrast": {"file": f_h, "folder": fo_h, "folderExpanded": fx_h,
            "rootFolder": r_h, "rootFolderExpanded": rx_h, **H},
}
p = f"{EXT}/themes/ruoste-icon-theme.json"
json.dump(theme, open(p,"w"), indent=2)
print(f"{n} svgs · {len(defs)} definitions")
print(f"{len(D['fileExtensions'])} ext · {len(D['fileNames'])} names · "
      f"{len(D['languageIds'])} langs · {len(D['folderNames'])} folders")
