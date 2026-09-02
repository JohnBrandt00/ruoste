"""RADIOHUB — paper / ink / oxide.  Palette definition + WCAG verification."""
import colorsys, json

def hex2rgb(h):
    h=h.lstrip('#'); return tuple(int(h[i:i+2],16) for i in (0,2,4))
def rgb2hex(r,g,b): return "#%02X%02X%02X"%(round(r),round(g),round(b))
def hsl(h,s,l):
    r,g,b = colorsys.hls_to_rgb(h/360, l/100, s/100)
    return rgb2hex(r*255,g*255,b*255)
def lum(h):
    def f(c):
        c/=255.0
        return c/12.92 if c<=0.04045 else ((c+0.055)/1.055)**2.4
    r,g,b=hex2rgb(h); return .2126*f(r)+.7152*f(g)+.0722*f(b)
def ratio(a,b):
    la,lb=lum(a),lum(b)
    if la<lb: la,lb=lb,la
    return (la+.05)/(lb+.05)
def mix(a,b,t):
    ra,ga,ba=hex2rgb(a); rb,gb,bb=hex2rgb(b)
    return rgb2hex(ra+(rb-ra)*t, ga+(gb-ga)*t, ba+(bb-ba)*t)
def alpha(h,a):  # VS Code supports #RRGGBBAA
    return h + "%02X"%round(a*255)

# ── hue anchors (mineral / oxide family, all restrained: S <= 55) ──────────
HUE = dict(rust=22, ochre=40, moss=84, verdigris=172, blueprint=208, madder=356, paper=48, ink=26)

DARK = dict(
    name="dark",
    bg      = "#14120E",   # ink, sampled from screenshot
    bg_deep = "#0D0B09",
    bg_lift = "#1B1813",
    fg      = "#E4DFD3",   # bone
    rule    = "#2C2822",   # hairline
    rule_lo = "#221F19",
    rust      = hsl(22,  52, 53),
    rust_lo   = hsl(22,  46, 40),
    rust_hi   = hsl(24,  62, 68),
    ochre     = hsl(40,  48, 58),
    ochre_lo  = hsl(40,  40, 44),
    moss      = hsl(84,  26, 53),
    verdigris = hsl(172, 34, 48),
    verd_hi   = hsl(172, 38, 60),
    blueprint = hsl(208, 30, 58),
    madder    = hsl(356, 48, 58),
    graphite  = hsl(38,  11, 48),   # comments
    graphite_hi=hsl(38,  10, 58),
    mute      = hsl(42,   8, 62),   # secondary text
    dim       = hsl(42,   7, 40),
)
LIGHT = dict(
    name="light",
    bg      = "#F2F0EA",   # paper, sampled from screenshot
    bg_deep = "#E9E6DE",
    bg_lift = "#FAF8F3",
    fg      = "#1A1712",
    rule    = "#D5D1C6",
    rule_lo = "#E2DFD6",
    rust      = hsl(22,  49, 40),   # #B0673D family, darkened for paper
    rust_lo   = hsl(22,  45, 32),
    rust_hi   = hsl(22,  54, 34),
    ochre     = hsl(38,  62, 33),
    ochre_lo  = hsl(38,  58, 26),
    moss      = hsl(88,  34, 30),
    verdigris = hsl(174, 46, 27),
    verd_hi   = hsl(174, 44, 34),
    blueprint = hsl(210, 42, 38),
    madder    = hsl(356, 56, 42),
    graphite  = hsl(36,  12, 40),
    graphite_hi=hsl(36,  10, 36),
    mute      = hsl(38,   8, 40),
    dim       = hsl(38,   8, 58),
)

CONTRAST = dict(
    name="contrast",
    bg      = "#0A0907",   # ink, pushed toward black
    bg_deep = "#000000",
    bg_lift = "#141210",
    fg      = "#F6F2E8",
    rule    = "#5A5348",   # rules are meant to be seen here
    rule_lo = "#403A32",
    rust      = hsl(24,  72, 64),
    rust_lo   = hsl(24,  60, 50),
    rust_hi   = hsl(26,  80, 76),
    ochre     = hsl(42,  70, 68),
    ochre_lo  = hsl(42,  58, 54),
    moss      = hsl(84,  42, 64),
    verdigris = hsl(172, 52, 60),
    verd_hi   = hsl(172, 58, 72),
    blueprint = hsl(206, 54, 70),
    madder    = hsl(356, 70, 70),
    graphite  = hsl(38,  16, 62),
    graphite_hi=hsl(38,  16, 74),
    mute      = hsl(42,  14, 78),
    dim       = hsl(42,  10, 56),
)

SYNTAX = ["rust","rust_hi","ochre","moss","verdigris","blueprint","madder",
          "graphite","mute","fg"]
if __name__ == "__main__":
    for P in (DARK, LIGHT, CONTRAST):
        print(f"\n=== {P['name'].upper()}  bg {P['bg']} ===")
        for k in SYNTAX:
            r = ratio(P[k], P['bg'])
            flag = "AAA" if r>=7 else "AA " if r>=4.5 else "aa " if r>=3 else "!! "
            print(f"  {k:11} {P[k]}  {r:5.2f}:1  {flag}")
