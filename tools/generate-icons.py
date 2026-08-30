#!/usr/bin/env python3
"""
Generate complete legacy + adaptive + monochrome launcher icons and the native
Android 12+ splash icon for PH ICS FOG, driven from the official square master
artwork exported from the authoritative 8.2.0 source or Play Console. Output is
written to resources/android/ and committed to source control.
"""
import os
from collections import deque
from PIL import Image, ImageFilter

SRC = 'resources/android/icon-master.png'
OUT = 'resources/android'

# Brand: a clean white background behind the official artwork, matching the
# app's splash/UI. {"density": (legacy_size_px, scale)}
DENS = {
    'mdpi':   (48,   1.0),
    'hdpi':   (72,   1.5),
    'xhdpi':  (96,   2.0),
    'xxhdpi': (144,  3.0),
    'xxxhdpi':(192,  4.0),
}
ADAPTIVE_DP = 108          # adaptive-icon / splash canvas size in dp
SAFE_ZONE_DP = 62          # logo fits within this centered square (safe circle diam ~66dp)
BACKGROUND = (255, 255, 255, 255)  # white

if not os.path.exists(SRC):
    raise SystemExit(
        'Missing resources/android/icon-master.png. Export the official artwork '
        'from 8.2.0 or Play Console; do not upscale www/img/96x96.png or logo.png.'
    )

logo = Image.open(SRC).convert('RGBA')
if logo.width < 512 or logo.height < 512:
    raise SystemExit('icon-master.png must be at least 512x512; refusing to upscale a low-resolution source.')


def scaled_logo(box_px):
    """Return the logo resized to fit inside box_px (square), keeping aspect."""
    s = min(box_px / logo.width, box_px / logo.height)
    return logo.resize((max(1, int(logo.width * s)), max(1, int(logo.height * s))), Image.LANCZOS)


def paste_center(canvas, im):
    """Center image im on canvas and paste it in place."""
    x = (canvas.width - im.width) // 2
    y = (canvas.height - im.height) // 2
    canvas.alpha_composite(im, (x, y))


def solid(w, h, rgba):
    im = Image.new('RGBA', (w, h), rgba)
    return im


def monochrome_mask(source):
    """Extract the official lettering/flag/slash as a themed-icon alpha mask.

    Using the source PNG's alpha channel directly would reduce this artwork to
    an indistinct solid rounded square. These conservative colour tests retain
    only the high-contrast foreground marks and intentionally omit its brown
    and orange background shapes.
    """
    rgba = source.convert('RGBA')
    width, height = rgba.size
    pixels = rgba.get_flattened_data() if hasattr(rgba, 'get_flattened_data') else rgba.getdata()

    # The large white ICS/FOG lettering is encoded as transparent cut-outs.
    # Flood-fill transparency connected to the canvas edge so it is treated as
    # exterior; any enclosed transparent regions are part of the lettering.
    transparent = [alpha <= 128 for _, _, _, alpha in pixels]
    exterior = bytearray(width * height)
    pending = deque()
    for x in range(width):
        pending.append(x)
        pending.append((height - 1) * width + x)
    for y in range(height):
        pending.append(y * width)
        pending.append(y * width + width - 1)
    while pending:
        index = pending.popleft()
        if exterior[index] or not transparent[index]:
            continue
        exterior[index] = 1
        x, y = index % width, index // width
        if x: pending.append(index - 1)
        if x + 1 < width: pending.append(index + 1)
        if y: pending.append(index - width)
        if y + 1 < height: pending.append(index + width)

    mask = Image.new('L', rgba.size, 0)
    output = []
    for index, (red, green, blue, alpha) in enumerate(pixels):
        white = min(red, green, blue) >= 205 and max(red, green, blue) - min(red, green, blue) <= 55
        brand_red = red - max(green, blue) >= 125
        brand_blue = blue - red >= 100 and green - red >= 55
        brand_yellow = min(red, green) - blue >= 115 and abs(red - green) <= 95
        enclosed_cutout = transparent[index] and not exterior[index]
        output.append(255 if enclosed_cutout else (alpha if (white or brand_red or brand_blue or brand_yellow) else 0))
    mask.putdata(output)
    # Restore a small amount of antialiasing lost at the classification edge.
    return mask.filter(ImageFilter.GaussianBlur(radius=0.45))


def save(im, *parts):
    path = os.path.join(OUT, *parts)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    im.save(path)
    print('wrote', path)


themed_master = monochrome_mask(logo)


for dens, (legacy_px, scale) in DENS.items():
    # ---- Legacy square launcher icon (white bg + logo) ----
    canvas = solid(legacy_px, legacy_px, BACKGROUND)
    paste_center(canvas, scaled_logo(int(legacy_px * 0.82)))
    save(canvas, 'mipmap-' + dens, 'ic_launcher.png')

    # ---- Adaptive foreground (logo in transparent 108dp canvas) ----
    F = int(ADAPTIVE_DP * scale)   # canvas px
    fg = Image.new('RGBA', (F, F), (0, 0, 0, 0))
    paste_center(fg, scaled_logo(int(SAFE_ZONE_DP * scale)))
    save(fg, 'mipmap-' + dens, 'ic_launcher_foreground.png')

    # ---- Adaptive background (solid color) ----
    save(solid(F, F, BACKGROUND), 'mipmap-' + dens, 'ic_launcher_background.png')

    # ---- Monochrome (themed-icon) foreground: official foreground marks ----
    mono = Image.new('RGBA', (F, F), (0, 0, 0, 0))
    mono_size = int(SAFE_ZONE_DP * scale)
    mask = themed_master.resize((mono_size, mono_size), Image.LANCZOS)
    mark = Image.new('RGBA', mask.size, (0, 0, 0, 255))
    mark.putalpha(mask)
    paste_center(mono, mark)
    save(mono, 'mipmap-' + dens, 'ic_launcher_monochrome.png')

# ---- Native Android 12+ splash icon (transparent logo) ----
SPLASH = 288
splash = Image.new('RGBA', (SPLASH, SPLASH), (0, 0, 0, 0))
paste_center(splash, scaled_logo(int(SPLASH * 0.55)))
save(splash, 'splash', 'ic_cdv_splashscreen.png')

print('done')
