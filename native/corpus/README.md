# Sample-file corpus

The files the native core must open, and what each must produce
(`corpus.toml`). `core/tests/corpus.rs` checks them; see
[`../README.md`](../README.md#corpus) for how to run it.

All files are generated, not real photos or videos. They show the same
96x64 test pattern (`references/pattern.png`): four coloured quadrants, so
a wrong rotation or mirror moves them; a white marker top left; and a grey
ramp along the bottom, which shows wrong colour handling.

## How the files were made

The references were made with ImageMagick 6:

- `pattern.png`: `convert -size 96x64 xc:'rgb(40,70,210)'`, rectangles drawn
  in rgb(220,40,40), rgb(40,180,60) and rgb(240,200,40), an 8-pixel
  `gradient:` strip along the bottom, and an 8x8 white square at (4,4).
- `pattern-alpha.png`: the pattern with alpha falling from 100% at the left
  to 12.5% at the right.
- `photo.png`: `convert -seed 7 -size 256x192 plasma:fractal -blur 0x1.5`.
- `square-256.png`: a 64x64 crop of the centre of the pattern, scaled up
  with `-filter point`.
- `viewbox-alpha.png`: `convert -size 96x64 xc:none +antialias`, the three
  rectangles of `svg/viewbox-alpha.svg` drawn with `-fill 'rgba(...)'
  -draw 'rectangle ...'`. ImageMagick 6's own SVG renderer gets the viewBox
  wrong, so it wasn't used.
- `pattern-mirrored.png`, `pattern-flipped.png`: `convert pattern.png -flop -strip`
  and `-flip -strip`, the second and third frames of the animations.

The samples, from those references:

| Samples | Made with |
| --- | --- |
| JPEG, PNG, GIF, WebP (still), BMP, TIFF | ImageMagick `convert`, for example `-quality 92 -sampling-factor 2x2`, `-interlace JPEG`, `-colorspace CMYK`, `PNG48:`, `BMP3:`, `-compress LZW` |
| `jpeg/adobe-rgb.jpg` | `convert -profile sRGB.icc -profile AdobeRGB1998.icc`, using colord's profiles (CC0) |
| `jpeg/orientation-N.jpg` | the pattern stored rotated, then `python3 exif_orientation.py IN OUT N` |
| `gif/animated.gif` | `convert -delay 10 a.png -delay 20 b.png -delay 30 c.png -loop 0` (b and c are the pattern mirrored and flipped) |
| `gif/short-delays.gif` | `convert -size 8x8 -delay 0 xc:'rgb(220,40,40)' -delay 1 xc:'rgb(40,180,60)' -delay 2 xc:'rgb(40,70,210)' -loop 0` |
| `webp/animated.webp` | Pillow 10.2: the three frames as RGB, `save(save_all=True, append_images=..., duration=[100, 200, 300], loop=0, lossless=True)` (ffmpeg's libwebp_anim does not keep the durations it is given) |
| `avif/yuv420.avif` | `ffmpeg -c:v libaom-av1 -crf 12 -still-picture 1` |
| `avif/10bit-444.avif` | ffmpeg 6.1 with libaom: `-vf scale=out_color_matrix=bt709:out_range=tv,format=yuv444p10le -colorspace bt709 -color_primaries bt709 -color_trc iec61966-2-1 -color_range tv -c:v libaom-av1 -crf 12 -still-picture 1` |
| `avif/alpha.avif`, `heic/yuv420.heic` | `heif-enc` from libheif 1.23 with aom and x265, `-q 90` |
| `avif/major-brand-mif1.avif` | `avif/alpha.avif` with the major brand of its `ftyp` box overwritten in place with `mif1` (`printf mif1 \| dd of=... bs=1 seek=8 conv=notrunc`); `avif` stays among the compatible brands |
| `avif/grid.avif` | `heif-enc -A -q 90 --cut-tiles 128 photo.png`: a 2x2 grid whose bottom row is cut to 64 rows, as for `heic/grid.heic` |
| `avif/rotated-mirrored.avif` | `in.png` as for `heic/rotated-mirrored.heic`, then `heif-enc -A -q 90 --rotate-cw 90 --flip-h in.png` |
| `avif/bitstream-colour.avif` | `avifenc` 1.4 `-q 90 --cicp 1/13/1 -r limited -y 420 pattern.png`, then its `colr` box renamed in place to `free` (`printf free \| dd of=... bs=1 seek=229 conv=notrunc`), so the BT.709 matrix and limited range are only in the AV1 sequence header. No encoder writes AVIF without a `colr` box; the renamed box stays an (ignored) property, so the indices in `ipma` still hold |
| `heic/10bit.heic` | `convert pattern.png -depth 16 PNG48:pattern16.png`, then `heif-enc -q 90 -b 10 pattern16.png` (`-b` only applies to 16-bit input; from an 8-bit PNG it writes 8-bit) |
| `heic/grid.heic` | `heif-enc -q 90 --cut-tiles 128 photo.png`: a 2x2 grid whose bottom row is cut to 64 rows |
| `heic/rotated-mirrored.heic` | `convert pattern.png -flop -rotate -90 -strip in.png`, then `heif-enc -q 90 --rotate-cw 90 --flip-h in.png`, which stores `in.png` as it is with `irot` and `imir` that show it as the pattern |
| `heic/alpha.heic` | `heif-enc -q 90 pattern-alpha.png` |
| `heic/adobe-rgb.heic` | `convert pattern.png -profile sRGB.icc -profile AdobeRGB1998.icc in.png` (colord's profiles, as for `jpeg/adobe-rgb.jpg`), then `heif-enc -q 90 in.png`, which keeps the profile |
| `jxl/lossless-alpha.jxl` | `cjxl -d 0` |
| `jxl/lossy.jxl` | `cjxl -d 1 pattern.png` (libjxl 0.7) |
| `jxl/jpeg-orientation-6.jxl`, `jxl/jpeg-adobe-rgb.jxl` | `cjxl` on `jpeg/orientation-6.jpg` and `jpeg/adobe-rgb.jpg`: lossless JPEG recompression, which keeps the orientation (in the codestream) and the ICC profile |
| `svg/pattern.svg` | written by hand: the pattern as rects and a linearGradient |
| `svg/viewbox-alpha.svg` | written by hand: a viewBox and no width or height, three semi-transparent rects |
| `svg/data-png.svg` | written by hand: an `<image>` whose href is `pattern.png` as a base64 `data:` URL |
| `ico/sizes-with-png.ico` | `convert square-256.png square-48.png square-16.png out.ico` |
| `video/*` | ffmpeg from the pattern scaled to 320x240: `-loop 1 -framerate 10 -t 2`, plus a `sine` audio track where the container has one. Codecs: libx264, libx265 (`-pix_fmt yuv420p10le -tag:v hvc1` for 10-bit), `prores_ks -profile:v 3`, libvpx-vp9 with Opus, libtheora with Vorbis, mpeg4 |

`scan/` is a folder for the scan check (`[[scan]]` in `corpus.toml`), not
decoded on its own. Its files are copies of the samples above under other
names: `png` (`png/rgba8.png`), `photo.dat` (`jpeg/baseline-420.jpg`), `svg`
(`svg/viewbox-alpha.svg`), `mp4` (`video/h264.m4v`) and `tiff`
(`tiff/lzw.tif`). The rest: `text.gif` and `notes.txt` are a line of text,
`junk` is `BM` and 62 random bytes (Python's `random.Random(7)`), and
`vorbis` is `ffmpeg -f lavfi -i sine=frequency=440:duration=0.2 -ac 1 -ar 8000
-c:a libvorbis -map_metadata -1 -fflags +bitexact -f ogg`.

Video-only Theora in Ogg made by ffmpeg reports a duration of 1.3 s for
2 s of frames, so `theora.ogg` has an audio track like `theora.ogv`.

## Adding a sample

Put the file under `samples/<format>/` and add a `[[sample]]` to
`corpus.toml` with its size, and a reference if a pixel check makes sense.
Don't use real user data. Files from elsewhere are fine if their licence
allows redistribution; record where they came from in a comment.
