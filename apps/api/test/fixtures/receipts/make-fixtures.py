"""
make-fixtures.py — U11-A1 R3: the receipt-format fixtures, generated in a VM.

Every picture is plain colour blocks drawn here: no photo, receipt, person or
place. Run once with Pillow and pillow-heif (whose wheels bundle the x265 HEVC
encoder); neither is a dependency of the app:

    python3 -m venv /tmp/fx && /tmp/fx/bin/pip install pillow pillow-heif
    /tmp/fx/bin/python make-fixtures.py

It writes the files beside itself, then prints each HEIC's ftyp brands and its
boxes, as proof that the HEICs are HEVC (an hvcC box) with the rotation (irot)
and primary item (pitm) the tests expect.
"""

import io
import os
import random
import struct
import sys
import zipfile

import pillow_heif
from PIL import Image, ImageDraw, TiffImagePlugin

HERE = os.path.dirname(os.path.abspath(__file__))
RED, GREY, BLUE, GREEN = (220, 30, 30), (128, 128, 128), (30, 60, 220), (30, 180, 60)


def write(name, data):
    with open(os.path.join(HERE, name), "wb") as f:
        f.write(data)


def marked(w, h, base, mark=RED):
    """A plain picture with a marker block in its top-left corner, so a test can
    tell which way up it came out."""
    im = Image.new("RGB", (w, h), base)
    ImageDraw.Draw(im).rectangle([0, 0, w // 4, h // 4], fill=mark)
    return im


def gps_exif():
    """EXIF with an invented GPS position, so a test can prove it is stripped."""
    exif = Image.Exif()
    exif[0x010F] = "Invented Camera"
    gps = exif.get_ifd(0x8825)
    gps[1], gps[2] = "N", (14.0, 35.0, 0.0)
    gps[3], gps[4] = "E", (121.0, 0.0, 0.0)
    return exif


def heic(im, **kw):
    buf = io.BytesIO()
    pillow_heif.from_pillow(im).save(buf, format="HEIF", quality=60, **kw)
    return buf.getvalue()


def as_bytes(im, fmt, **kw):
    buf = io.BytesIO()
    im.save(buf, format=fmt, **kw)
    return buf.getvalue()


# --- HEIC (HEVC) -------------------------------------------------------------------

# One image, 320×240, carrying EXIF with GPS.
write("heic-plain.heic", heic(marked(320, 240, GREY), exif=gps_exif().tobytes()))

# Encoded 320×240 with EXIF orientation 8; pillow-heif turns that into an irot box
# (a quarter turn anticlockwise), so the upright picture is 240×320.
rot_exif = Image.Exif()
rot_exif[0x0112] = 8
write("heic-irot90.heic", heic(marked(320, 240, GREY), exif=rot_exif.tobytes()))

# Two images: a 160×120 green one first, then the primary, a 200×300 blue one.
two = pillow_heif.HeifFile()
two.add_from_pillow(Image.new("RGB", (160, 120), GREEN))
two.add_from_pillow(marked(200, 300, BLUE))
buf = io.BytesIO()
two.save(buf, quality=60, primary_index=1)
write("heic-two-images.heic", buf.getvalue())

# --- The other formats sharp or bmp-js reads -------------------------------------

png = Image.new("RGBA", (300, 200), (0, 0, 0, 0))  # transparent background
ImageDraw.Draw(png).rectangle([0, 0, 75, 50], fill=RED + (255,))
write("photo.png", as_bytes(png, "PNG"))
write("photo.webp", as_bytes(marked(300, 200, GREY), "WEBP", quality=80))
# GIF: two frames; the first is grey with the red marker, the second all blue.
write(
    "photo.gif",
    as_bytes(
        marked(300, 200, GREY).convert("P"),
        "GIF",
        save_all=True,
        append_images=[Image.new("RGB", (300, 200), BLUE).convert("P")],
    ),
)
# TIFF: two pages; the first is grey with the red marker, the second all blue.
write(
    "photo.tiff",
    as_bytes(
        marked(300, 200, GREY),
        "TIFF",
        save_all=True,
        append_images=[Image.new("RGB", (300, 200), BLUE)],
    ),
)
write("photo.bmp", as_bytes(marked(300, 200, GREY), "BMP"))
write("photo.avif", as_bytes(marked(300, 200, GREY), "AVIF", quality=60))
# A JPEG with EXIF and GPS, uploaded under a name that says nothing about it.
write("photo.dat", as_bytes(marked(300, 200, GREY), "JPEG", exif=gps_exif().tobytes()))

# --- Files the Portal refuses ------------------------------------------------------


def box(kind, payload):
    return struct.pack(">I", 8 + len(payload)) + kind + payload


# An MP4's header: an ftyp box (isom, mp42), then an empty moov and a short mdat.
write(
    "clip.mp4",
    box(b"ftyp", b"isom" + struct.pack(">I", 0x200) + b"isommp42")
    + box(b"moov", b"")
    + box(b"mdat", bytes(64)),
)

# A DNG is a TIFF whose first directory carries DNGVersion (tag 50706).
ifd = TiffImagePlugin.ImageFileDirectory_v2()
ifd[50706] = b"\x01\x04\x00\x00"
ifd.tagtype[50706] = 1
ifd[0x010F] = "Invented Camera"
write("raw.dng", as_bytes(Image.new("RGB", (64, 48), GREY), "TIFF", tiffinfo=ifd))

# A minimal Word document.
docx = io.BytesIO()
with zipfile.ZipFile(docx, "w", zipfile.ZIP_DEFLATED) as z:
    z.writestr(
        "[Content_Types].xml",
        '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    )
    z.writestr(
        "word/document.xml",
        '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        "<w:body><w:p><w:r><w:t>An invented letter.</w:t></w:r></w:p></w:body></w:document>",
    )
write("letter.docx", docx.getvalue())

# Random bytes from a fixed seed.
write("noise.bin", random.Random(11).randbytes(4096))

# --- Proof: brands and boxes of each HEIC -----------------------------------------


def boxes(data, start, end, depth, out):
    i = start
    while i + 8 <= end:
        size, kind = struct.unpack(">I4s", data[i : i + 8])
        kind = kind.decode("latin1")
        head = 8
        if size == 1:
            size, head = struct.unpack(">Q", data[i + 8 : i + 16])[0], 16
        elif size == 0:
            size = end - i
        body = i + head
        extra = ""
        if kind == "ftyp":
            major = data[body : body + 4].decode("latin1")
            compat = [
                data[j : j + 4].decode("latin1") for j in range(body + 8, i + size, 4)
            ]
            extra = f" major={major} compatible={','.join(compat)}"
        elif kind == "pitm":
            extra = f" primary_item={struct.unpack('>H', data[body + 4 : body + 6])[0]}"
        elif kind == "irot":
            extra = f" angle={(data[body] & 3) * 90} deg anticlockwise"
        elif kind == "ispe":
            w, h = struct.unpack(">II", data[body + 4 : body + 12])
            extra = f" {w}x{h}"
        out.append("  " * depth + kind + extra)
        if kind in ("meta",):
            boxes(data, body + 4, i + size, depth + 1, out)
        elif kind in ("iprp", "ipco", "dinf"):
            boxes(data, body, i + size, depth + 1, out)
        i += size


for name in ("heic-plain.heic", "heic-irot90.heic", "heic-two-images.heic"):
    data = open(os.path.join(HERE, name), "rb").read()
    out = []
    boxes(data, 0, len(data), 0, out)
    flat = " ".join(out)
    hvcc = flat.count("hvcC")
    print(f"{name}: {len(data)} bytes, hvcC boxes={hvcc}")
    print("\n".join("  " + line for line in out))
    if hvcc == 0:
        sys.exit(f"{name} carries no hvcC box: not HEVC")
