import json, os, pathlib
from palette import DARK, LIGHT, CONTRAST
from workbench import workbench
from syntax import semantic, textmate
import pathlib
ROOT = pathlib.Path(__file__).resolve().parent.parent

OUT = str(ROOT / "themes")
os.makedirs(OUT, exist_ok=True)

THEMES = (
    (DARK,     "RUOSTE",           "dark",   "ruoste-color-theme.json"),
    (LIGHT,    "RUOSTE Paperi",    "light",  "ruoste-paperi-color-theme.json"),
    (CONTRAST, "RUOSTE Kontrasti", "hcDark", "ruoste-kontrasti-color-theme.json"),
)

for P, label, kind, fname in THEMES:
    theme = {
        "$schema": "vscode://schemas/color-theme",
        "name": label,
        "type": kind,
        "semanticHighlighting": True,
        "colors": workbench(P),
        "semanticTokenColors": semantic(P),
        "tokenColors": textmate(P),
    }
    with open(os.path.join(OUT, fname), "w") as f:
        json.dump(theme, f, indent=2, ensure_ascii=False); f.write("\n")
    print(f"{label:18} {kind:7} {len(theme['colors']):4} workbench  "
          f"{len(theme['semanticTokenColors']):3} semantic  "
          f"{len(theme['tokenColors']):3} textmate  ->  {fname}")
