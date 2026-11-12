// The HEIC decoder's one call into libheif, used by heic.rs. It is C++ so
// that it is compiled against the pinned libheif headers (the options and
// limits structs are versioned, and written here by field name, not by a
// layout copied into Rust) and so that no C++ exception can reach Rust: only
// some of libheif's C functions catch their own, and one escaping into Rust
// would abort the process.

#include <libheif/heif.h>

#include <cstdint>
#include <cstdlib>
#include <memory>
#include <mutex>

extern "C" {

// A decoded picture. `rgba` points into `image` and is valid until
// pv_heic_release. The context lives as long as the image: libheif keys
// its memory accounting by the context's limits, and an image freed after
// its context would be counted against whichever context is allocated at
// the same address next.
struct pv_heic_picture {
  heif_context* context;
  const heif_image* image;
  const uint8_t* rgba;
  size_t stride;
  uint32_t width;
  uint32_t height;
  // Whether the colour in `rgba` is multiplied by alpha.
  uint8_t premultiplied;
  // The embedded ICC profile, or null; malloc'd.
  uint8_t* icc;
  size_t icc_size;
};

}

namespace {

enum Result : int {
  PV_HEIC_OK = 0,
  PV_HEIC_UNSUPPORTED = 1,
  PV_HEIC_DECODE = 2,
};

// What libheif may allocate per pixel of the largest picture allowed, all
// buffers together: the decoded planes at up to 16 bits, the RGBA result,
// and a conversion step in between. A 121-megapixel 10-bit 4:4:4 grid
// needs about 11.
constexpr uint64_t BYTES_PER_PIXEL = 16;

struct ContextFree {
  void operator()(heif_context* context) const { heif_context_free(context); }
};
struct HandleRelease {
  void operator()(const heif_image_handle* handle) const { heif_image_handle_release(handle); }
};
struct ImageRelease {
  void operator()(const heif_image* image) const { heif_image_release(image); }
};
struct OptionsFree {
  void operator()(heif_decoding_options* options) const { heif_decoding_options_free(options); }
};

int result_of(const heif_error& error)
{
  switch (error.code) {
    case heif_error_Ok:
      return PV_HEIC_OK;
    case heif_error_Unsupported_filetype:
    case heif_error_Unsupported_feature:
      return PV_HEIC_UNSUPPORTED;
    case heif_error_Plugin_loading_error:
      // An image in a codec other than HEVC: only libde265 is built in.
      return error.subcode == heif_suberror_No_matching_decoder_installed ? PV_HEIC_UNSUPPORTED : PV_HEIC_DECODE;
    default:
      return PV_HEIC_DECODE;
  }
}

// Sets a context's security limits from the largest picture allowed, so a
// hostile file can't make libheif allocate much more than that picture
// needs. libheif also passes the image size limit on to libde265.
void limit(heif_security_limits* limits, uint64_t max_pixels)
{
  limits->max_image_size_pixels = max_pixels;
  // iPhone photos are grids of 512x512 tiles; this allows tiles down to
  // 128x128 at the largest size.
  limits->max_number_of_tiles = max_pixels / (128 * 128);
  // Every tile is an item, and so is every tile of the alpha grid. The
  // default of 1000 refuses a picture at the largest size in 512x512 tiles
  // with alpha.
  limits->max_items = uint32_t(2 * limits->max_number_of_tiles + 1000);
  limits->max_color_profile_size = 4 << 20;
  // The largest single buffer is the RGBA result.
  limits->max_memory_block_size = max_pixels * 4 + (64 << 20);
  limits->max_total_memory = max_pixels * BYTES_PER_PIXEL;
}

int decode(const uint8_t* data, size_t size, uint64_t max_pixels, int threads, pv_heic_picture* out);

}  // namespace

extern "C" {

// Decodes the primary image of a HEIF file to 8-bit RGBA, transformations
// applied, at most `max_pixels` in size, on at most `threads` threads.
// Returns 0 on success, 1 if the file uses something libheif can't decode
// here (another codec, for one), 2 if it is damaged. On success `out` holds
// the picture, to be given back with pv_heic_release.
int pv_heic_decode(const uint8_t* data, size_t size, uint64_t max_pixels, int threads, pv_heic_picture* out)
{
  *out = pv_heic_picture{};
  try {
    return decode(data, size, max_pixels, threads, out);
  }
  catch (...) {
    // An exception left `out` partly filled at most: the image and context
    // are only set once everything else has succeeded.
    std::free(out->icc);
    *out = pv_heic_picture{};
    return PV_HEIC_DECODE;
  }
}

void pv_heic_release(pv_heic_picture* picture)
{
  heif_image_release(picture->image);
  heif_context_free(picture->context);
  std::free(picture->icc);
  *picture = pv_heic_picture{};
}

}  // extern "C"

namespace {

int decode(const uint8_t* data, size_t size, uint64_t max_pixels, int threads, pv_heic_picture* out)
{
  // heif_context_alloc would initialise libheif too, but checks whether it
  // has without a lock.
  static std::once_flag initialised;
  std::call_once(initialised, [] { heif_init(nullptr); });

  std::unique_ptr<heif_context, ContextFree> context(heif_context_alloc());
  if (!context) {
    return PV_HEIC_DECODE;
  }
  limit(heif_context_get_security_limits(context.get()), max_pixels);
  // Tiles of a grid decode in parallel, one libde265 decoder (with one
  // worker thread) each; every thread is joined before heif_decode_image
  // returns.
  heif_context_set_max_decoding_threads(context.get(), threads);

  heif_error error = heif_context_read_from_memory_without_copy(context.get(), data, size, nullptr);
  if (error.code != heif_error_Ok) {
    return result_of(error);
  }
  heif_image_handle* raw_handle = nullptr;
  error = heif_context_get_primary_image_handle(context.get(), &raw_handle);
  std::unique_ptr<const heif_image_handle, HandleRelease> handle(raw_handle);
  if (error.code != heif_error_Ok || !handle) {
    return error.code == heif_error_Ok ? PV_HEIC_DECODE : result_of(error);
  }

  // The size as displayed, checked before any pixels are decoded. libheif
  // checks the coded size of each item against max_image_size_pixels too.
  int width = heif_image_handle_get_width(handle.get());
  int height = heif_image_handle_get_height(handle.get());
  if (width <= 0 || height <= 0 || uint64_t(width) * uint64_t(height) > max_pixels) {
    return PV_HEIC_DECODE;
  }

  std::unique_ptr<heif_decoding_options, OptionsFree> options(heif_decoding_options_alloc());
  if (!options) {
    return PV_HEIC_DECODE;
  }
  // Rotation, mirroring and cropping from the file are applied by libheif
  // (ignore_transformations stays off). Bilinear chroma upsampling, which
  // libheif otherwise only prefers, is what viewers show.
  options->convert_hdr_to_8bit = 1;
  options->color_conversion_options.preferred_chroma_upsampling_algorithm = heif_chroma_upsampling_bilinear;
  options->color_conversion_options.only_use_preferred_chroma_algorithm = 1;

  heif_image* raw_image = nullptr;
  error = heif_decode_image(handle.get(), &raw_image, heif_colorspace_RGB, heif_chroma_interleaved_RGBA,
                            options.get());
  std::unique_ptr<const heif_image, ImageRelease> image(raw_image);
  if (error.code != heif_error_Ok || !image) {
    return error.code == heif_error_Ok ? PV_HEIC_DECODE : result_of(error);
  }

  width = heif_image_get_width(image.get(), heif_channel_interleaved);
  height = heif_image_get_height(image.get(), heif_channel_interleaved);
  size_t stride = 0;
  const uint8_t* rgba = heif_image_get_plane_readonly2(image.get(), heif_channel_interleaved, &stride);
  if (!rgba || width <= 0 || height <= 0 || uint64_t(width) * uint64_t(height) > max_pixels ||
      stride < size_t(width) * 4 || heif_image_get_bits_per_pixel_range(image.get(), heif_channel_interleaved) != 8) {
    return PV_HEIC_DECODE;
  }

  heif_color_profile_type profile = heif_image_handle_get_color_profile_type(handle.get());
  if (profile == heif_color_profile_type_prof || profile == heif_color_profile_type_rICC) {
    size_t icc_size = heif_image_handle_get_raw_color_profile_size(handle.get());
    if (icc_size > 0) {
      out->icc = static_cast<uint8_t*>(std::malloc(icc_size));
      if (out->icc &&
          heif_image_handle_get_raw_color_profile(handle.get(), out->icc).code == heif_error_Ok) {
        out->icc_size = icc_size;
      }
      else {
        // The picture is still shown, as if it had no profile.
        std::free(out->icc);
        out->icc = nullptr;
      }
    }
  }

  out->rgba = rgba;
  out->stride = stride;
  out->width = uint32_t(width);
  out->height = uint32_t(height);
  out->premultiplied = heif_image_is_premultiplied_alpha(const_cast<heif_image*>(image.get())) ? 1 : 0;
  out->image = image.release();
  out->context = context.release();
  return PV_HEIC_OK;
}

}  // namespace
