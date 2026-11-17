#!/usr/bin/env python3
"""Inserts an EXIF APP1 segment holding only an Orientation tag into a JPEG.

  python3 exif_orientation.py IN.jpg OUT.jpg ORIENTATION
"""

import struct
import sys

source, target, orientation = sys.argv[1], sys.argv[2], int(sys.argv[3])
data = open(source, "rb").read()
assert data[:2] == b"\xff\xd8", "not a JPEG"
# Big-endian TIFF header, one IFD with one entry: tag 0x0112, SHORT, count 1.
tiff = b"MM\x00\x2a" + struct.pack(">I", 8) + struct.pack(">H", 1)
tiff += struct.pack(">HHIHH", 0x0112, 3, 1, orientation, 0) + struct.pack(">I", 0)
payload = b"Exif\x00\x00" + tiff
segment = b"\xff\xe1" + struct.pack(">H", len(payload) + 2) + payload
position = 2
if data[2:4] == b"\xff\xe0":  # keep a JFIF APP0 first
    position = 4 + struct.unpack(">H", data[4:6])[0]
open(target, "wb").write(data[:position] + segment + data[position:])
