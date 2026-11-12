// The HEIF decoder's one call into libheif, used by heif.rs, and the AV1
// decoder plugin that hands libheif's AV1 data to rav1d (av1.rs). It is C++
// so that it is compiled against the pinned libheif headers (the options,
// limits and plugin structs are versioned, and written here by field name,
// not by a layout copied into Rust) and so that no C++ exception can reach
// Rust: only some of libheif's C functions catch their own, and one escaping
// into Rust would abort the process. The Rust it calls catches its own
// panics, so none unwinds into libheif.

#include <libheif/heif.h>
#include <libheif/heif_items.h>
#include <libheif/heif_plugin.h>

#include <algorithm>
#include <climits>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <mutex>
#include <vector>

extern "C" {

// A decoded picture. `rgba` points into `image` and is valid until
// pv_heif_release. The context lives as long as the image: libheif keys
// its memory accounting by the context's limits, and an image freed after
// its context would be counted against whichever context is allocated at
// the same address next.
struct pv_heif_picture {
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

// A picture decoded by rav1d, from av1.rs: `pv_av1_frame` there.
struct pv_av1_frame {
  void* picture;
  const uint8_t* planes[3];
  size_t strides[3];
  uint32_t widths[3];
  uint32_t heights[3];
  uint32_t bits;
  // 0 monochrome, 1 4:2:0, 2 4:2:2, 3 4:4:4.
  uint32_t layout;
  uint16_t primaries;
  uint16_t transfer;
  uint16_t matrix;
  uint8_t full_range;
};

int pv_av1_decode(const uint8_t* data, size_t size, int threads, pv_av1_frame* out);
void pv_av1_release(pv_av1_frame* frame);

}

namespace {

enum Result : int {
  PV_HEIF_OK = 0,
  PV_HEIF_UNSUPPORTED = 1,
  PV_HEIF_DECODE = 2,
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
struct FrameRelease {
  void operator()(pv_av1_frame* frame) const { pv_av1_release(frame); }
};

int result_of(const heif_error& error)
{
  switch (error.code) {
    case heif_error_Ok:
      return PV_HEIF_OK;
    case heif_error_Unsupported_filetype:
    case heif_error_Unsupported_feature:
      return PV_HEIF_UNSUPPORTED;
    case heif_error_Plugin_loading_error:
      // An image in a codec other than HEVC and AV1: only libde265 is
      // built in, and rav1d registered.
      return error.subcode == heif_suberror_No_matching_decoder_installed ? PV_HEIF_UNSUPPORTED : PV_HEIF_DECODE;
    default:
      return PV_HEIF_DECODE;
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

int decode(const uint8_t* data, size_t size, uint64_t max_pixels, int threads, int tile_threads,
           pv_heif_picture* out);

// libheif's AV1 decoder: rav1d, through av1.rs. libheif makes one decoder
// per image (each grid tile, the alpha image), pushes it the image's AV1
// data, and asks for the picture until it gets one. Every callback catches
// what libheif's C functions might throw.
namespace rav1d_plugin {

const heif_error ok = {heif_error_Ok, heif_suberror_Unspecified, "Success"};
const heif_error failed = {heif_error_Decoder_plugin_error, heif_suberror_Unspecified, "The AV1 data does not decode"};
const heif_error out_of_memory = {heif_error_Memory_allocation_error, heif_suberror_Unspecified, "Out of memory"};

struct Decoder {
  std::vector<uint8_t> data;
  // From heif_decoding_options' num_codec_threads; 0 for rav1d's minimum.
  int threads;
  bool decoded;
};

const char* name() { return "rav1d"; }

int priority(heif_compression_format format) { return format == heif_compression_AV1 ? 100 : 0; }

int priority2(const heif_decoder_plugin_compressed_format_description* format)
{
  return format ? priority(format->format) : 0;
}

heif_error new_decoder2(void** out, const heif_decoder_plugin_options* options)
{
  try {
    *out = new Decoder{{}, options ? options->num_threads : 0, false};
    return ok;
  }
  catch (...) {
    *out = nullptr;
    return out_of_memory;
  }
}

heif_error new_decoder(void** out)
{
  return new_decoder2(out, nullptr);
}

void free_decoder(void* decoder) { delete static_cast<Decoder*>(decoder); }

void set_strict_decoding(void*, int) {}

heif_error push_data2(void* raw, const void* data, size_t size, uintptr_t)
{
  auto* decoder = static_cast<Decoder*>(raw);
  try {
    auto* bytes = static_cast<const uint8_t*>(data);
    decoder->data.insert(decoder->data.end(), bytes, bytes + size);
    return ok;
  }
  catch (...) {
    return out_of_memory;
  }
}

heif_error push_data(void* decoder, const void* data, size_t size) { return push_data2(decoder, data, size, 0); }

// All the data is decoded at once, at the first ask for the picture.
heif_error flush_data(void*) { return ok; }

// Copies rav1d's planes and colour description into a new libheif image.
// The colour description is the sequence header's: libheif replaces it with
// the file's nclx when there is one.
//
// libheif turns a monochrome image into RGB without looking at its range, so
// a limited-range one (a grey picture or an alpha image) is expanded to full
// range here and said to be full range, as other decoders show it.
heif_error to_image(const pv_av1_frame& frame, const heif_security_limits* limits, heif_image** out)
{
  heif_colorspace colorspace = heif_colorspace_YCbCr;
  heif_chroma chroma;
  switch (frame.layout) {
    case 0:
      colorspace = heif_colorspace_monochrome;
      chroma = heif_chroma_monochrome;
      break;
    case 1:
      chroma = heif_chroma_420;
      break;
    case 2:
      chroma = heif_chroma_422;
      break;
    case 3:
      chroma = heif_chroma_444;
      break;
    default:
      return failed;
  }
  if (frame.widths[0] > INT_MAX || frame.heights[0] > INT_MAX) {
    return failed;
  }
  heif_image* raw_image = nullptr;
  heif_error error = heif_image_create(int(frame.widths[0]), int(frame.heights[0]), colorspace, chroma, &raw_image);
  std::unique_ptr<heif_image, ImageRelease> image(raw_image);
  if (error.code != heif_error_Ok || !image) {
    return failed;
  }

  heif_color_profile_nclx nclx{};
  // Code points libheif doesn't know are set to unspecified.
  heif_nclx_color_profile_set_color_primaries(&nclx, frame.primaries);
  heif_nclx_color_profile_set_transfer_characteristics(&nclx, frame.transfer);
  heif_nclx_color_profile_set_matrix_coefficients(&nclx, frame.matrix);
  bool expand = chroma == heif_chroma_monochrome && !frame.full_range;
  nclx.full_range_flag = frame.full_range || expand;
  heif_image_set_nclx_color_profile(image.get(), &nclx);

  // Limited range runs from 16 to 235, scaled up for more bits.
  std::vector<uint16_t> full_range;
  if (expand) {
    int max = (1 << frame.bits) - 1;
    double unit = double(1 << (frame.bits - 8));
    full_range.resize(size_t(max) + 1);
    for (int value = 0; value <= max; value++) {
      long expanded = std::lround((value - 16 * unit) * max / (219 * unit));
      full_range[size_t(value)] = uint16_t(std::clamp<long>(expanded, 0, max));
    }
  }

  const heif_channel channels[3] = {heif_channel_Y, heif_channel_Cb, heif_channel_Cr};
  int planes = chroma == heif_chroma_monochrome ? 1 : 3;
  size_t sample_bytes = frame.bits > 8 ? 2 : 1;
  for (int index = 0; index < planes; index++) {
    // The error's message can belong to the image, which is released on
    // the way out; the code says enough.
    error = heif_image_add_plane_safe(image.get(), channels[index], int(frame.widths[index]),
                                      int(frame.heights[index]), int(frame.bits), limits);
    if (error.code != heif_error_Ok) {
      return {error.code, error.subcode, "The AV1 picture is not allowed"};
    }
    size_t stride = 0;
    uint8_t* plane = heif_image_get_plane2(image.get(), channels[index], &stride);
    size_t row = size_t(frame.widths[index]) * sample_bytes;
    if (!plane || stride < row) {
      return failed;
    }
    // av1.rs checked that rav1d's rows hold `row` bytes.
    for (uint32_t y = 0; y < frame.heights[index]; y++) {
      uint8_t* to = plane + y * stride;
      const uint8_t* from = frame.planes[index] + y * frame.strides[index];
      if (!expand) {
        std::memcpy(to, from, row);
      }
      else if (sample_bytes == 1) {
        for (uint32_t x = 0; x < frame.widths[index]; x++) {
          to[x] = uint8_t(full_range[from[x]]);
        }
      }
      else {
        // rav1d's samples are below 1 << bits, as the table's indices.
        auto* wide_to = reinterpret_cast<uint16_t*>(to);
        auto* wide_from = reinterpret_cast<const uint16_t*>(from);
        for (uint32_t x = 0; x < frame.widths[index]; x++) {
          wide_to[x] = full_range[std::min<size_t>(wide_from[x], full_range.size() - 1)];
        }
      }
    }
  }
  *out = image.release();
  return ok;
}

heif_error decode_next_image2(void* raw, heif_image** out, uintptr_t* user_data, const heif_security_limits* limits)
{
  *out = nullptr;
  if (user_data) {
    *user_data = 0;
  }
  auto* decoder = static_cast<Decoder*>(raw);
  // A still image is one picture; asked again, there is none.
  if (decoder->decoded) {
    return ok;
  }
  decoder->decoded = true;
  pv_av1_frame frame{};
  if (pv_av1_decode(decoder->data.data(), decoder->data.size(), decoder->threads, &frame) != 0) {
    return failed;
  }
  // rav1d's picture and threads are released before this returns.
  std::unique_ptr<pv_av1_frame, FrameRelease> held(&frame);
  try {
    return to_image(frame, limits ? limits : heif_get_global_security_limits(), out);
  }
  catch (...) {
    return failed;
  }
}

heif_error decode_next_image(void* decoder, heif_image** out, const heif_security_limits* limits)
{
  return decode_next_image2(decoder, out, nullptr, limits);
}

heif_error decode_image(void* decoder, heif_image** out)
{
  return decode_next_image2(decoder, out, nullptr, nullptr);
}

// Filled by field name for plugin API version 6, the latest in the pinned
// headers; fields a later version adds stay zero.
heif_decoder_plugin make()
{
  heif_decoder_plugin plugin{};
  plugin.plugin_api_version = 6;
  plugin.get_plugin_name = name;
  plugin.does_support_format = priority;
  plugin.new_decoder = new_decoder;
  plugin.free_decoder = free_decoder;
  plugin.push_data = push_data;
  plugin.decode_image = decode_image;
  plugin.set_strict_decoding = set_strict_decoding;
  plugin.id_name = "rav1d";
  plugin.decode_next_image = decode_next_image;
  plugin.minimum_required_libheif_version = LIBHEIF_MAKE_VERSION(1, 23, 0);
  plugin.does_support_format2 = priority2;
  plugin.new_decoder2 = new_decoder2;
  plugin.push_data2 = push_data2;
  plugin.flush_data = flush_data;
  plugin.decode_next_image2 = decode_next_image2;
  return plugin;
}

}  // namespace rav1d_plugin

}  // namespace

extern "C" {

// Decodes the primary image of a HEIF file (HEIC or AVIF) to 8-bit RGBA,
// transformations applied, at most `max_pixels` in size. `threads` is how
// many the machine has; at most `tile_threads` grid tiles decode at once.
// Returns 0 on success, 1 if the file uses something libheif can't decode
// here (another codec, for one), 2 if it is damaged. On success `out` holds
// the picture, to be given back with pv_heif_release.
int pv_heif_decode(const uint8_t* data, size_t size, uint64_t max_pixels, int threads, int tile_threads,
                   pv_heif_picture* out)
{
  *out = pv_heif_picture{};
  try {
    return decode(data, size, max_pixels, threads, tile_threads, out);
  }
  catch (...) {
    // An exception left `out` partly filled at most: the image and context
    // are only set once everything else has succeeded.
    std::free(out->icc);
    *out = pv_heif_picture{};
    return PV_HEIF_DECODE;
  }
}

void pv_heif_release(pv_heif_picture* picture)
{
  heif_image_release(picture->image);
  heif_context_free(picture->context);
  std::free(picture->icc);
  *picture = pv_heif_picture{};
}

}  // extern "C"

namespace {

int decode(const uint8_t* data, size_t size, uint64_t max_pixels, int threads, int tile_threads,
           pv_heif_picture* out)
{
  // heif_context_alloc would initialise libheif too, but checks whether it
  // has without a lock. libheif's list of decoders isn't locked either, so
  // rav1d is added here, before any decode.
  static std::once_flag initialised;
  std::call_once(initialised, [] {
    heif_init(nullptr);
    static const heif_decoder_plugin rav1d = rav1d_plugin::make();
    heif_register_decoder_plugin(&rav1d);
  });

  std::unique_ptr<heif_context, ContextFree> context(heif_context_alloc());
  if (!context) {
    return PV_HEIF_DECODE;
  }
  limit(heif_context_get_security_limits(context.get()), max_pixels);
  // Tiles of a grid decode in parallel, one decoder each; every thread is
  // joined before heif_decode_image returns.
  heif_context_set_max_decoding_threads(context.get(), tile_threads);

  heif_error error = heif_context_read_from_memory_without_copy(context.get(), data, size, nullptr);
  if (error.code != heif_error_Ok) {
    return result_of(error);
  }
  heif_image_handle* raw_handle = nullptr;
  error = heif_context_get_primary_image_handle(context.get(), &raw_handle);
  std::unique_ptr<const heif_image_handle, HandleRelease> handle(raw_handle);
  if (error.code != heif_error_Ok || !handle) {
    return error.code == heif_error_Ok ? PV_HEIF_DECODE : result_of(error);
  }

  // The size as displayed, checked before any pixels are decoded. libheif
  // checks the coded size of each item against max_image_size_pixels too.
  int width = heif_image_handle_get_width(handle.get());
  int height = heif_image_handle_get_height(handle.get());
  if (width <= 0 || height <= 0 || uint64_t(width) * uint64_t(height) > max_pixels) {
    return PV_HEIF_DECODE;
  }

  std::unique_ptr<heif_decoding_options, OptionsFree> options(heif_decoding_options_alloc());
  if (!options) {
    return PV_HEIF_DECODE;
  }
  // Rotation, mirroring and cropping from the file are applied by libheif
  // (ignore_transformations stays off). Bilinear chroma upsampling, which
  // libheif otherwise only prefers, is what viewers show.
  options->convert_hdr_to_8bit = 1;
  options->color_conversion_options.preferred_chroma_upsampling_algorithm = heif_chroma_upsampling_bilinear;
  options->color_conversion_options.only_use_preferred_chroma_algorithm = 1;
  // libde265 keeps its single worker thread (num_codec_threads 0). rav1d
  // gets the machine's threads for a single image, and a share of them for
  // each grid tile decoding at once; av1.rs gives it at least two. A file
  // that doesn't say AVIF gets that minimum.
  if (heif_has_compatible_brand(data, int(std::min<size_t>(size, INT_MAX)), "avif") == 1) {
    bool grid = heif_item_get_item_type(context.get(), heif_image_handle_get_item_id(handle.get())) ==
                heif_fourcc('g', 'r', 'i', 'd');
    options->num_codec_threads = grid ? threads / std::max(tile_threads, 1) : threads;
  }

  heif_image* raw_image = nullptr;
  error = heif_decode_image(handle.get(), &raw_image, heif_colorspace_RGB, heif_chroma_interleaved_RGBA,
                            options.get());
  std::unique_ptr<const heif_image, ImageRelease> image(raw_image);
  if (error.code != heif_error_Ok || !image) {
    return error.code == heif_error_Ok ? PV_HEIF_DECODE : result_of(error);
  }

  width = heif_image_get_width(image.get(), heif_channel_interleaved);
  height = heif_image_get_height(image.get(), heif_channel_interleaved);
  size_t stride = 0;
  const uint8_t* rgba = heif_image_get_plane_readonly2(image.get(), heif_channel_interleaved, &stride);
  if (!rgba || width <= 0 || height <= 0 || uint64_t(width) * uint64_t(height) > max_pixels ||
      stride < size_t(width) * 4 || heif_image_get_bits_per_pixel_range(image.get(), heif_channel_interleaved) != 8) {
    return PV_HEIF_DECODE;
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
  return PV_HEIF_OK;
}

}  // namespace
