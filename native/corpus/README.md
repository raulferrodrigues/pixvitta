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
| `webp/animated.webp` | ffmpeg's concat demuxer with per-frame durations, `-fps_mode vfr -c:v libwebp_anim -lossless 1` |
| `avif/yuv420.avif` | `ffmpeg -c:v libaom-av1 -crf 12 -still-picture 1` |
| `avif/alpha.avif`, `heic/*.heic` | `heif-enc` from libheif 1.23 with aom and x265 (`-q 90`; `-b 10` for 10-bit) |
| `jxl/lossless-alpha.jxl` | `cjxl -d 0` |
| `svg/pattern.svg` | written by hand: the pattern as rects and a linearGradient |
| `ico/sizes-with-png.ico` | `convert square-256.png square-48.png square-16.png out.ico` |
| `video/*` | ffmpeg from the pattern scaled to 320x240: `-loop 1 -framerate 10 -t 2`, plus a `sine` audio track where the container has one. Codecs: libx264, libx265 (`-pix_fmt yuv420p10le -tag:v hvc1` for 10-bit), `prores_ks -profile:v 3`, libvpx-vp9 with Opus, libtheora with Vorbis, mpeg4 |

Video-only Theora in Ogg made by ffmpeg reports a duration of 1.3 s for
2 s of frames, so `theora.ogg` has an audio track like `theora.ogv`.

## Adding a sample

Put the file under `samples/<format>/` and add a `[[sample]]` to
`corpus.toml` with its size, and a reference if a pixel check makes sense.
Don't use real user data. Files from elsewhere are fine if their licence
allows redistribution; record where they came from in a comment.
