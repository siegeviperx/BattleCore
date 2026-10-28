"""Turn raw transparent character renders into die-cut sticker PNGs for the board.

Usage:  python art-source/build_stickers.py                    (Babies and Dinos: all of art-source/pieces)
        python art-source/build_stickers.py w-p b-p            (just these)
        python art-source/build_stickers.py --pack dragons     (a pack: all of art-source/packs/dragons/pieces)
        python art-source/build_stickers.py --pack dragons k q (just these slots)

Input:  art-source/pieces/<color>-<type>.png, or art-source/packs/<id>/pieces/<slot>.png
        (RGBA, transparent background, e.g. from Meshy)
Output: client/src/packs/<id>/pieces/<slot>.png  (512x640, matches the cutout canvas)
        Slots are k q r b n p, plus p2 p3 ... for extra looks. The original art maps w-* to the babies
        pack and b-* to the dinos pack (w-p2 -> babies/pieces/p2.png).
"""
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "art-source" / "pieces"
PACKS = ROOT / "client" / "src" / "packs"
LEGACY_PACKS = {"w": "babies", "b": "dinos"}

W, H = 512, 640          # 2x the 256x320 logical cutout canvas
MARGIN = 24              # room for border + shadow
BORDER = 16              # white die-cut border thickness (px)
SHADOW_OFFSET = (0, 9)
SHADOW_BLUR = 10
SHADOW_ALPHA = 0.5


def target(name: str, pack: str | None) -> Path:
    """Where the sticker for `name` goes: a pack slot, or the Babies/Dinos slot for legacy w-*/b-* names."""
    if pack:
        return PACKS / pack / "pieces" / f"{name}.png"
    color, slot = name.split("-", 1)
    return PACKS / LEGACY_PACKS[color] / "pieces" / f"{slot}.png"


def build(name: str, pack: str | None = None) -> Path:
    src = (ROOT / "art-source" / "packs" / pack / "pieces") if pack else SRC
    im = Image.open(src / f"{name}.png").convert("RGBA")
    # Treat near-transparent fringe from background removal as empty.
    alpha = im.getchannel("A").point(lambda v: 0 if v < 24 else v)
    im.putalpha(alpha)
    im = im.crop(alpha.getbbox())

    # Fit inside the canvas, feet at the bottom so the character stands on its base.
    scale = min((W - 2 * MARGIN) / im.width, (H - 2 * MARGIN) / im.height)
    im = im.resize((round(im.width * scale), round(im.height * scale)), Image.LANCZOS)
    x = (W - im.width) // 2
    y = H - MARGIN - im.height
    char = Image.new("RGBA", (W, H))
    char.paste(im, (x, y))

    # Border: grow the silhouette, then smooth it into rounded die-cut edges.
    solid = char.getchannel("A").point(lambda v: 255 if v > 96 else 0)
    grown = solid.filter(ImageFilter.GaussianBlur(BORDER * 0.7)).point(lambda v: 255 if v > 10 else 0)
    grown = grown.filter(ImageFilter.GaussianBlur(1.2))

    shadow_alpha = grown.filter(ImageFilter.GaussianBlur(SHADOW_BLUR)).point(lambda v: int(v * SHADOW_ALPHA))
    shadow_alpha = ImageChops.offset(shadow_alpha, *SHADOW_OFFSET)

    out = Image.new("RGBA", (W, H))
    out.paste(Image.new("RGBA", (W, H), (0, 0, 0, 255)), mask=shadow_alpha)
    out.paste(Image.new("RGBA", (W, H), (255, 255, 255, 255)), mask=grown)
    out.alpha_composite(char)

    dest = target(name, pack)
    dest.parent.mkdir(parents=True, exist_ok=True)
    out.save(dest, optimize=True)
    return dest


if __name__ == "__main__":
    args = sys.argv[1:]
    pack = None
    if args[:1] == ["--pack"]:
        if len(args) < 2:
            sys.exit("usage: build_stickers.py --pack <id> [slots...]")
        pack, args = args[1], args[2:]
    src = (ROOT / "art-source" / "packs" / pack / "pieces") if pack else SRC
    names = args or sorted(p.stem for p in src.glob("*.png"))
    for n in names:
        print("built", build(n, pack).relative_to(ROOT))
