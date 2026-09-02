"""RADIOHUB — Phosphor duotone icon renderer.
Files : duotone glyph, tinted, backdrop lifted to 0.30 for 16px legibility.
Folders: duotone folder shell + a BOLD glyph inset in the body (composite)."""
import os, re, pathlib, xml.etree.ElementTree as ET
import pathlib
ROOT = pathlib.Path(__file__).resolve().parent.parent

SRC  = str(ROOT / "node_modules/@phosphor-icons/core/assets")
OUT  = str(ROOT / "icons")
os.makedirs(OUT, exist_ok=True)
BACKDROP = "0.30"

def _paths(name, weight):
    p = f"{SRC}/{weight}/{name}-{weight}.svg"
    if not os.path.exists(p): raise FileNotFoundError(p)
    body = open(p).read()
    return re.findall(r'<path[^>]*/>', body)

def _split_duotone(name):
    """returns (backdrop_d, main_d) from a duotone svg"""
    back, main = [], []
    for tag in _paths(name, "duotone"):
        d = re.search(r'\sd="([^"]+)"', tag).group(1)
        (back if 'opacity=' in tag else main).append(d)
    return back, main

def file_icon(name, color, out):
    back, main = _split_duotone(name)
    b = "".join(f'<path d="{d}" opacity="{BACKDROP}"/>' for d in back)
    m = "".join(f'<path d="{d}"/>' for d in main)
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" '
           f'fill="{color}">{b}{m}</svg>')
    open(f"{OUT}/{out}.svg", "w").write(svg)

# glyph placement per shell: (scale, cx, cy) of the usable interior
FIT = {
    "folder":        (0.325, 128.0, 141.0),
    "folder-simple": (0.325, 128.0, 141.0),
    "folder-open":   (0.255, 139.0, 161.0),
}

def folder_icon(color, out, glyph=None, shell="folder", glyph_weight="bold"):
    sc, cx, cy = FIT.get(shell, FIT["folder"])
    back, main = _split_duotone(shell)
    b = "".join(f'<path d="{d}" opacity="{BACKDROP}"/>' for d in back)
    m = "".join(f'<path d="{d}"/>' for d in main)
    g = ""
    if glyph:
        gp = "".join(re.search(r'\sd="([^"]+)"', t).group(1)
                     for t in _paths(glyph, glyph_weight))
        g = (f'<g transform="translate({cx-128*sc:.2f},{cy-128*sc:.2f}) '
             f'scale({sc})"><path d="{gp}"/></g>')
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" '
           f'fill="{color}">{b}{m}{g}</svg>')
    open(f"{OUT}/{out}.svg", "w").write(svg)
