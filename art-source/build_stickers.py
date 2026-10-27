"""Turn raw transparent character renders into die-cut sticker PNGs for the board.

Usage:  python art-source/build_stickers.py            (all images in art-source/pieces)
        python art-source/build_stickers.py w-p b-p    (just these)

Input:  art-source/pieces/<color>-<type>.png  (RGBA, transparent background, e.g. from Meshy)
Output: client/public/assets/pieces/<color>-<type>.png  (512x640, matches the cutout canvas)
"""
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "art-source" / "pieces"
OUT = ROOT / "client" / "public" / "assets" / "pieces"

W, H = 512, 640          # 2x the 256x320 logical cutout canvas
MARGIN = 24              # room for border + shadow
BORDER = 16              # white die-cut border thickness (px)
SHADOW_OFFSET = (0, 9)
SHADOW_BLUR = 10
SHADOW_ALPHA = 0.5


def build(name: str) -> Path:
    im = Image.open(SRC / f"{name}.png").convert("RGBA")
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

    OUT.mkdir(parents=True, exist_ok=True)
    dest = OUT / f"{name}.png"
    out.save(dest, optimize=True)
    return dest


if __name__ == "__main__":
    names = sys.argv[1:] or sorted(p.stem for p in SRC.glob("*.png"))
    for n in names:
        print("built", build(n).relative_to(ROOT))
