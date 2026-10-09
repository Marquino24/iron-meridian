"""Reproject public-domain world imagery into the game's Miller projection.

  python3 tools/build-imagery.py

Inputs (downloaded into data/raw/img/, git-ignored):
  bm-topo.jpg       NASA Blue Marble Next Generation, topography + bathymetry, Aug 2004, 5400x2700 (public domain)
  NE2_50M_SR_W/     Natural Earth II, land cover + shaded relief + water, 1:50m (public domain)
  SR_50M.tif        Natural Earth shaded relief, 1:50m (public domain)
Outputs (assets/, committed):
  satellite.webp    Blue Marble + subtle extra relief shading on land
  terrain.webp      Natural Earth II land cover with shaded relief
Both cover the game world exactly: Miller projection, 180°W–180°E, 58°S–84°N.
"""
import math, os, sys
import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, 'data', 'raw', 'img')
OUT = os.path.join(ROOT, 'assets')

# Must match js/projection.js
WORLD_W, LAT_MIN, LAT_MAX = 4000, -58, 84
def miller_y(lat): return 1.25 * math.log(math.tan(math.pi / 4 + 0.4 * math.radians(lat)))
Y_TOP, Y_BOT = miller_y(LAT_MAX), miller_y(LAT_MIN)
R = WORLD_W / (2 * math.pi)
WORLD_H = round(R * (Y_TOP - Y_BOT))

OUT_W = 4096
OUT_H = round(OUT_W * WORLD_H / WORLD_W)

def sample_grid(src_w, src_h):
    """Source pixel coordinates (float) for every output pixel."""
    xs = (np.arange(OUT_W) + 0.5) / OUT_W                     # 0..1 across 360°
    ys = (np.arange(OUT_H) + 0.5) / OUT_H                     # 0..1 top→bottom
    my = Y_TOP - ys * (Y_TOP - Y_BOT)                          # Miller y
    lat = np.degrees(2.5 * np.arctan(np.exp(0.8 * my)) - 0.625 * math.pi)
    sx = xs * src_w - 0.5
    sy = (90 - lat) / 180 * src_h - 0.5
    return np.meshgrid(sx, sy)

def bilinear(img, sx, sy):
    a = np.asarray(img, dtype=np.float32)
    if a.ndim == 2: a = a[..., None]
    h, w = a.shape[:2]
    x0 = np.floor(sx).astype(int); y0 = np.floor(sy).astype(int)
    fx = (sx - x0)[..., None]; fy = (sy - y0)[..., None]
    x0c = np.mod(x0, w); x1c = np.mod(x0 + 1, w)               # wrap longitude
    y0c = np.clip(y0, 0, h - 1); y1c = np.clip(y0 + 1, 0, h - 1)
    top = a[y0c, x0c] * (1 - fx) + a[y0c, x1c] * fx
    bot = a[y1c, x0c] * (1 - fx) + a[y1c, x1c] * fx
    return top * (1 - fy) + bot * fy

def reproject(path, mode='RGB'):
    img = Image.open(path).convert(mode)
    sx, sy = sample_grid(*img.size)
    return bilinear(img, sx, sy)

def save(arr, name, quality):
    im = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8).squeeze())
    p = os.path.join(OUT, name)
    im.save(p, 'WEBP', quality=quality, method=6)
    print(f'{name}: {im.size[0]}x{im.size[1]}, {os.path.getsize(p) / 1024:.0f} KB')

os.makedirs(OUT, exist_ok=True)
relief = reproject(os.path.join(RAW, 'SR_50M.tif'), 'L') / 255.0     # 1 = flat, darker = shaded slopes

# Satellite: Blue Marble with a little extra relief on land (water stays as is).
bm = reproject(os.path.join(RAW, 'bm-topo.jpg'))
land = (relief < 0.985).astype(np.float32)                         # SR_50M is flat (≈1) over water
shade = 1 - (1 - relief) * 0.45 * land
save(bm * shade, 'satellite.webp', 68)

# Terrain: Natural Earth II (already land cover + relief + water).
ne2_path = next(os.path.join(RAW, 'NE2_50M_SR_W', f) for f in os.listdir(os.path.join(RAW, 'NE2_50M_SR_W')) if f.lower().endswith('.tif'))
save(reproject(ne2_path), 'terrain.webp', 70)
