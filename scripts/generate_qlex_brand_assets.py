#!/usr/bin/env python3
"""Generate qlex platform icon derivatives from the approved raster mark."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "app/assets/img/qlex-mark.png"
CYAN = (34, 211, 238, 255)
GRAPHITE = (17, 24, 39, 255)
FOG = (248, 250, 252, 255)


def contain(image: Image.Image, size: int, fraction: float) -> Image.Image:
    target = max(1, round(size * fraction))
    fitted = image.copy()
    fitted.thumbnail((target, target), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.alpha_composite(fitted, ((size - fitted.width) // 2, (size - fitted.height) // 2))
    return canvas


def rounded_background(size: int, radius_fraction: float = 0.22) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    draw.rounded_rectangle(
        (0, 0, size - 1, size - 1),
        radius=round(size * radius_fraction),
        fill=GRAPHITE,
    )
    return canvas


def write_png(image: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, format="PNG", optimize=True)


def main() -> None:
    source = Image.open(SOURCE).convert("RGBA")

    for size in (32, 128, 256, 512):
        write_png(contain(source, size, 0.92), ROOT / f"app/assets/img/logo-{size}.png")

    black = contain(source, 32, 0.92)
    black.putalpha(black.getchannel("A"))
    solid_black = Image.new("RGBA", black.size, GRAPHITE)
    solid_black.putalpha(black.getchannel("A"))
    write_png(solid_black, ROOT / "app/assets/img/logo-32-black.png")

    solid_white = Image.new("RGBA", black.size, FOG)
    solid_white.putalpha(black.getchannel("A"))
    write_png(solid_white, ROOT / "app/assets/img/logo-32-white.png")

    densities = {
        "mdpi": (48, 108),
        "hdpi": (72, 162),
        "xhdpi": (96, 216),
        "xxhdpi": (144, 324),
        "xxxhdpi": (192, 432),
    }
    for density, (legacy_size, adaptive_size) in densities.items():
        legacy = rounded_background(legacy_size)
        legacy.alpha_composite(contain(source, legacy_size, 0.76))
        resource_dir = ROOT / f"app/android/app/src/main/res/mipmap-{density}"
        write_png(legacy, resource_dir / "ic_launcher.png")
        if density == "xxxhdpi":
            write_png(legacy, resource_dir / "ic_launcher_round.png")

        foreground = contain(source, adaptive_size, 0.66)
        write_png(foreground, resource_dir / "ic_launcher_foreground.png")

        monochrome = Image.new("RGBA", foreground.size, FOG)
        monochrome.putalpha(foreground.getchannel("A"))
        write_png(monochrome, resource_dir / "ic_launcher_monochrome.png")

    splash = contain(source, 256, 0.62)
    write_png(splash, ROOT / "app/android/app/src/main/res/drawable/qlex_splash.png")

    ico_source = rounded_background(512)
    ico_source.alpha_composite(contain(source, 512, 0.76))
    ico_sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    ico_source.save(ROOT / "app/assets/img/logo.ico", sizes=ico_sizes)
    ico_source.save(ROOT / "app/windows/runner/resources/app_icon.ico", sizes=ico_sizes)


if __name__ == "__main__":
    main()
