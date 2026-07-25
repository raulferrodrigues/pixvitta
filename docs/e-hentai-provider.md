# E-Hentai Gallery Provider

## Status

Requirements, feasibility study, and a deliberately tiny vertical slice.
This work is local and must not be pushed until it has been reviewed and tested
manually.

## Experimental vertical slice

The current local implementation proves this path:

```text
public gallery URL
  -> documented metadata API
  -> lightweight items for every gallery page
  -> selected page establishes selected + ten-neighbor demand
  -> lazy gallery-index HTML resolution
  -> stable image-page URLs
  -> normal displayed WebP
  -> session disk cache
  -> opaque media URLs
  -> renderer
```

The gallery opens after one metadata request. Its gallery-index HTML is not
enumerated up front. Selecting a page lazily resolves only the required index
page, requests the selected image, then sequentially prefetches up to five
pages ahead followed by up to five pages behind. Gallery boundaries clamp the
window; it never wraps. Jumping elsewhere replaces background work that has
not started; an active transfer finishes and enters the cache.

The experiment has these hard boundaries:

- only `https://e-hentai.org/g/{gallery_id}/{gallery_token}/` is accepted;
- only the normal displayed rendition is fetched;
- any normal displayed image format supported by Pixvitta is accepted;
- original images are never requested;
- cache misses pass through one provider-global transfer pipeline;
- transfer starts are serialized with a minimum two-second interval;
- cache hits do not consume a transfer slot;
- image bytes remain under Pixvitta's versioned `media-cache` directory for
  the current application session;
- thumbnails use opaque Pixvitta resources and a separate session cache;
- thumbnail cache misses use a separate scheduler that admits no more than
  twenty starts in a one-second sliding window and no more than twenty active
  transfers;
- individual downloads save the normal displayed rendition;
- original-image, bulk-gallery, and authenticated downloads are not
  implemented.

## Goal

Allow a user to paste a public E-Hentai gallery URL into Pixvitta and view the
gallery through the existing provider-neutral media library.

The initial URL shape under consideration is:

```text
https://e-hentai.org/g/{gallery_id}/{gallery_token}/
```

React must not contain E-Hentai-specific behavior. The provider should expose a
normal Pixvitta collection and keep site-specific request, parsing, quota, and
URL-lifetime behavior in main.

## Confirmed external behavior

### Gallery metadata is documented

The documented `gdata` API accepts a gallery ID and token and returns stable
metadata including:

- English and Japanese titles;
- category and tags;
- gallery thumbnail;
- file count and total size;
- posted timestamp;
- expunged/replacement information.

It does not return the ordered image-page tokens or durable direct URLs for all
gallery images.

### The ordered index is HTML

An anonymous standard gallery page currently exposes 20 ordered items per
index page. Each item contains:

- a stable image-page URL shaped like
  `https://e-hentai.org/s/{page_token}/{gallery_id}-{page_number}`;
- the original filename in a title attribute;
- an `ehgt.org` thumbnail URL embedded in CSS.

The page also exposes gallery-index pagination. A tested 329-image gallery
required 17 index pages. At the documented 2,000-image gallery maximum, the
anonymous layout can require approximately 100 index requests.

The API does not document this HTML as a machine contract. Any parser will be
an integration risk and must be defensive and fixture-tested.

### Full media is resolved from an image page

The stable image page currently contains an `<img id="img">` whose `src` is a
temporary delivery URL. In the observed response, that URL used a dynamically
named Hentai@Home host and a non-default HTTPS port.

The official FAQ states that direct H@H image links can expire after about 15
minutes and server-hosted links after about 24 hours. A direct URL cannot be an
item ID and should not be stored as durable collection state.

### Displayed and original files are different products

The normal image page may serve a resized or converted image. In the observed
case, the original gallery filename was `.jpg` while the displayed image was a
resampled `.webp`.

The separate “Download original” URL may consume Full Image Quota, GP, or
credits. Pixvitta must not follow it implicitly.

This makes the current provider download contract unsafe for an MVP:

- using the original filename for displayed bytes can create a file whose
  extension does not match its content;
- using the original-download link can have account/quota cost;
- resolving the true displayed filename occurs too late for the current static
  `ProviderMediaItem.name`.

### Image access has quotas and anti-abuse constraints

Image views consume a limit that normally belongs to the user's IP address.
Force-reloading a failed image has a much larger cost. Official documentation
also warns that overly intensive automated downloads can lead to IP bans.

The provider must not:

- prefetch all full images;
- automatically use the site's force-reload mechanism;
- retry failed images aggressively;
- enumerate or download a whole gallery as if it were an archive;
- bypass 509/quota responses.

### Pixvitta already virtualizes the filmstrip

The renderer creates a public `MediaItem` for each page, but mounts thumbnails
only around the visible filmstrip window. This makes a lazy index-page strategy
possible without changing React or incrementally mutating a collection.

An array of up to 2,000 lightweight placeholder items is reasonable. Fetching
100 gallery-index pages before showing the first image is not.

## Scope that appears safe

- Public `e-hentai.org` galleries opened by pasted canonical URL.
- No ExHentai.
- No credentials, cookie import, or account actions.
- No search, favorites, gallery discovery, tags UI, comments, or ratings.
- No original-image or gallery-archive downloading.
- No attempts to access removed, private, or otherwise unavailable galleries.
- Display normal/resampled images at the resolution E-Hentai returns for an
  anonymous request.
- Refresh and “Open gallery in browser” through existing provider-neutral
  capabilities.

## Direction agreed in discussion

- Full media loading is intentionally lazy and slow.
- The provider must enforce a hard maximum of one new full-image transfer every
  two seconds.
- The selected image is followed by up to five images ahead, then up to five
  images behind, in that order.
- The prefetch window is clamped to the gallery boundaries and never wraps.
- Prefetching must obey the same hard gate; it does not create parallel image
  transfers.
- Successfully fetched images enter an explicit cache so back-navigation does
  not download them again.
- The provider will be implemented as several focused deep modules within its
  own folder rather than one large provider file.
- E-Hentai items expose provider-owned opaque thumbnail resources. Site URLs,
  request policy, caching, and failures remain private to main.
- Thumbnail cache misses use their own twenty-starts-per-second pipeline with
  at most twenty active transfers. They never enter or delay the two-second
  full-image pipeline.
- Missing or failed thumbnails return a successful transparent placeholder so
  the renderer never falls back to fetching full media for the filmstrip.

The format decision is explicit: the provider requests the site's normal
displayed rendition and accepts any supported image content type. WebP is an
observed delivery format, not part of the provider contract.

HTTP 509 handling remains required before this provider is considered ready.
The current generic media failure is insufficient. We still need to determine
the exact provider behavior and UI, but it must:

- recognize 509 as an image-quota response rather than a broken image;
- stop current background prefetch immediately;
- prevent additional automatic full-image requests while quota is exhausted;
- avoid force reloads or aggressive retries;
- explain the condition clearly to the user;
- provide only an explicitly chosen, policy-safe recovery action.

## Thumbnail request-rate research

As of July 25, 2026, official E-Hentai documentation publishes no numeric
request limit for per-page files served from `ehgt.org`.

The documented metadata API limit does not apply automatically to the
thumbnail host. Its guidance is specific to API calls: up to 25 metadata
entries per request, with roughly four or five sequential API requests before
waiting about five seconds.

The normal gallery UI is designed to request thumbnail rows as ordinary page
assets. E-Hentai documents four thumbnail rows per gallery by default and up
to forty with account perks. This strongly suggests that the thumbnail
infrastructure expects normal browser-style batches and concurrency. It does
not establish an unlimited or formally safe automation rate.

The documentation also says that smaller thumbnails for new or updated
galleries are generated after larger thumbnails and may temporarily be
unavailable. A missing thumbnail must therefore be treated as normal and must
not trigger aggressive retries.

Conclusions for the thumbnail discussion:

- there is no official requests-per-second value we can truthfully implement;
- the two-second full-image gate should not be assumed to apply to thumbnails;
- we should not load-test or probe the service to discover an unpublished
  threshold;
- Pixvitta will mirror an ordinary visible gallery page by admitting batches
  of up to twenty new thumbnail transfers per one-second sliding window;
- active thumbnail transfers are also capped at twenty, so slow responses
  cannot accumulate unbounded work;
- successful thumbnails are cached for the session, duplicate in-flight work
  is coalesced, and cache hits bypass the scheduler;
- galleries that expose a shared H@H WebP sprite fetch that sprite once; each
  opaque page thumbnail returns only the validated CSS crop through an embedded
  SVG wrapper that Chromium can decode;
- HTTP 429 or 503 pauses new thumbnail starts, honoring a numeric
  `Retry-After` when present and otherwise backing off for thirty seconds.

Official references:

- <https://ehwiki.org/wiki/API>
- <https://ehwiki.org/wiki/Galleries>
- <https://ehwiki.org/wiki/Gallery_FAQ>
- <https://ehwiki.org/wiki/Making_Galleries>

## Proposed deep-module ownership

The complexity should be divided by ownership, not by creating many shallow
utility files.

### `E HentaiProvider`

The narrow provider façade:

- recognizes and canonicalizes gallery URLs;
- asks the metadata client to construct a gallery session;
- maps the session into a provider-neutral `ProviderCollection`;
- exposes refresh and origin capabilities.

It must not perform raw image downloads itself.

### `GallerySession`

Owns one immutable gallery snapshot:

- validated metadata and file count;
- stable page-number identities;
- lazy gallery-index page lookup;
- mapping from a page number to its thumbnail and stable image-page URL;
- the current desired prefetch window.

When page `N` becomes selected, the desired full-media set becomes:

```text
urgent: N
background order:
  N+1, N+2, N+3, N+4, N+5,
  N-1, N-2, N-3, N-4, N-5
```

Entries outside `1...fileCount` are omitted rather than wrapped. This should
not be an unbounded FIFO queue. If the user jumps to another page, background
work that has not started is replaced by the new desired window. The one
transfer already in progress is allowed to finish and enter the cache rather
than wasting a likely quota hit.

### `FullImagePipeline`

The only module with the capability to fetch bytes from approved full-media
delivery hosts.

It owns:

- selected-versus-prefetch priority;
- the global hard rate gate;
- single-transfer concurrency;
- duplicate request coalescing;
- image-page resolution and short-lived delivery URLs;
- response validation;
- atomic writes to the image cache;
- serving cached content back to media resources.

The rate limit must be global to the provider instance, not per gallery
session. The previous collection can briefly remain alive during an
authoritative handoff, and opening a new gallery must not reset or bypass the
two-second boundary.

The invariant should be stronger than “roughly debounced”:

- no more than one full-image transfer is active;
- consecutive transfer start times are at least 2,000 milliseconds apart;
- every caller, including selected media, prefetch, future downloads, and tests,
  uses the same entry point;
- raw full-media `fetch` access is private to this module;
- adversarial concurrent requests are covered by a fake-clock test.

If a transfer takes longer than two seconds, the next transfer starts only
after it finishes. That is stricter than the minimum interval and avoids
parallel quota consumption.

### `ImageCache`

The storage mechanism should be a generic Pixvitta deep module that future
providers can reuse. E-Hentai owns the identity and fetch policy; the generic
cache owns byte storage and lifecycle.

The separation is:

```text
Provider
  decides stable identity, freshness, and what is allowed to be fetched

Provider image pipeline
  decides selected/prefetch priority and enforces network rate policy

Generic media cache
  decides whether bytes already exist and stores/serves them safely
```

The generic cache owns downloaded normal/resampled image bytes:

- stable keys derived from gallery ID and stable page token/page number;
- write-to-temporary-file plus atomic rename;
- content type and byte length as cache metadata.

The provider pipeline owns in-flight request coalescing because it also owns
network admission and the two-second gate.

Chromium's implicit HTTP cache is not strong enough for the “never download it
again when going back” guarantee. The provider needs an explicit cache.

The cache does not perform arbitrary networking. A provider asks it for an
opaque namespaced key and supplies an authorized producer for a miss. This
keeps provider-specific host validation, credentials, quotas, and rate limits
out of the generic storage module.

For E-Hentai, the durable media key should include the stable image-page token,
not the temporary H@H delivery URL. If a gallery update replaces an image, its
page token changes and naturally produces a cache miss. The old blob becomes
irrelevant and remains only until the next application launch.

Cache hits never enter the two-second network gate. A miss is submitted to the
provider pipeline, and the pipeline checks the cache again immediately before
starting network work. This second check closes the race where another selected
or prefetch request filled the cache while the job was waiting.

The intended behavior is:

```text
Select page 1
  desired: 1, 2, 3, 4, 5, 6
  cache: all miss
  network: fetch 1 through 6 under the hard gate

Jump to page 300
  urgent: 300
  background order: 301, 302, 303, 304, 305, 299, 298, 297, 296, 295
  cache: all miss
  network: fetch them under the same hard gate

Return to page 2
  urgent: 2
  background order: 3, 4, 5, 6, 7, 1
  cache: 1 through 6 hit and are served immediately
  network: only page 7 is admitted
```

The generic module supports provider namespaces without inheriting E-Hentai's
two-second gate or neighbor-prefetch rule. It intentionally has no size limit,
LRU, access tracking, statistics, byte-range behavior, content-addressed storage,
or separate media/thumbnail budgets.

Instead, the complete versioned `media-cache/v1` directory is deleted once at
application startup, before any source operation can begin. Normal startup,
command-line opens, OS open-file events, and renderer IPC all await the same
one-time cleanup promise. This makes it a session cache:

- navigating back during the same run reuses downloaded images;
- quitting normally performs no filesystem work;
- the next launch deletes the previous run's cache, including anything left by
  a crash or forced termination;
- a long-running session may use unbounded cache space, which is accepted for
  this experiment.

### `ThumbnailRepository`

Implemented as a provider-private thumbnail pipeline over the generic resource
cache:

- a page number is lazily mapped to the `ehgt.org` URL from its gallery-index
  page;
- the renderer sees only an opaque `pixvitta-media://thumbnail/...` resource;
- cache hits return immediately and concurrent misses for the same item share
  one operation;
- cache misses enter a twenty-starts-per-second sliding window with at most
  twenty active transfers;
- Electron's network stack performs the request so gallery-style thumbnail
  batches can reuse Chromium's normal connection and HTTP/2 behavior;
- supported image formats are validated before bytes enter the separate
  thumbnail cache namespace;
- both individual `ehgt.org` thumbnails and validated H@H WebP sprite sheets
  are supported;
- a sprite is cached and coalesced by its upstream URL, so twenty page crops
  sharing one sheet make one upstream request rather than twenty;
- sprite dimensions and CSS crop bounds are validated in main, then a
  self-contained SVG applies the crop without exposing the upstream URL to
  React;
- a missing or failed thumbnail becomes a successful transparent placeholder,
  preventing renderer fallback from consuming a full-image request.

This module owns only thumbnail traffic. It cannot admit work to the full-image
pipeline.

### `MetadataClient` and private parsers

Own documented API requests, defensive HTML parsing, URL validation, timeouts,
and provider error mapping. They are control-plane modules and never receive
permission to fetch approved full-media delivery URLs directly.

## Prefetch start point

Starting full-image prefetch inside `provider.load()` would allow a candidate
collection to consume quota before the authoritative media library commits it.

The cleaner trigger is the first media request after commit:

1. metadata and the collection commit;
2. React requests selected page 1;
3. page 1 becomes urgent;
4. pages 2 through 6 become the forward background window; there are no valid
   backward pages and nothing wraps from the end of the gallery;
5. the global pipeline fetches them serially under the hard gate.

To the user this still begins immediately after metadata loading, but ownership
remains correct if collection construction or publication fails.

## Collection-loading options

### Option A: eagerly enumerate every index page

Load metadata, fetch every gallery-index page, then build exact items with real
filenames, page URLs, and thumbnails.

Advantages:

- fits the existing provider contract directly;
- every item has accurate presentation data immediately;
- implementation and resource closures are straightforward.

Problems:

- a maximum-size gallery can require roughly 100 HTML requests before commit;
- opening can take tens of seconds even without conservative pacing;
- it performs substantial automated enumeration even if the user views one
  page;
- request concurrency and rate policy become difficult to justify;
- it works against the site's warning about intensive automated access.

This is not recommended.

### Option B: create lazy page-number items

Load documented metadata and use `filecount` to create stable lightweight items
such as `Page 001`, `Page 002`, and so on.

Each media resource knows its page number. A shared index cache fetches the
corresponding gallery-index page only when selected media requests it.
Concurrent requests for items on the same index page share one in-flight fetch.

Advantages:

- gallery opening requires only one API request;
- full images remain strictly user-driven;
- filmstrip activity requests only governed thumbnail resources, never full
  media;
- supports the current authoritative one-shot collection commit;
- scales to 2,000 pages without loading the whole remote index.

Costs:

- item names remain page numbers rather than original filenames;
- file sizes are unknown per item;
- individual downloads use page-number filenames plus the validated delivered
  extension rather than the original gallery filename;
- per-item image-page URLs are not available for context-menu copying until
  their index page has been loaded;
- an index HTML request may occur when the user jumps far through the gallery.

This is the recommended MVP.

### Option C: add paged/incremental provider collections

Extend the deep module so a provider can discover and publish collection items
incrementally.

Advantages:

- accurate item metadata could arrive progressively;
- naturally models remote catalogs larger than E-Hentai galleries;
- may help future providers.

Problems:

- changes the provider contract, media catalog, authoritative collection
  handoff, IPC projection, renderer store, and navigation semantics;
- reintroduces questions about ownership while a collection changes;
- much larger than an E-Hentai provider experiment.

This should be a separate architecture project if future providers demonstrate
the need.

## Recommended request flow

If Option B is accepted:

1. Strictly parse and canonicalize the gallery URL.
2. Request documented `gdata` metadata.
3. Reject invalid tokens, expunged/unavailable galleries, invalid counts, and
   unsupported responses.
4. Create one stable page-number item per `filecount`, without fetching full
   media or gallery-index pages.
5. Resolve a thumbnail by lazily fetching and caching its gallery-index page,
   then pass the `ehgt.org` cache miss through the thumbnail scheduler.
6. Resolve full media by obtaining the stable image-page URL from the same
   index cache, fetching that image page, validating its temporary delivery
   URL, and proxying the image.
7. Keep temporary delivery URLs uncached or cached for a deliberately short
   lifetime well below the documented 15-minute minimum.
8. Do not automatically force-reload or repeatedly retry a failed image.

## Security boundary

All extracted URLs must be parsed and independently validated:

- gallery and image pages: exact HTTPS `e-hentai.org`;
- API: exact HTTPS `api.e-hentai.org`;
- thumbnails: exact HTTPS `ehgt.org`, or validated HTTPS `*.hath.network`
  sprite sheets with bounded CSS crops;
- normal media: approved E-Hentai delivery hosts, including validated
  `*.hath.network` HTTPS hosts that may use non-default ports;
- no credentials in URLs;
- no arbitrary redirects;
- image-page gallery ID and page number must match the requested item;
- upstream full-media responses must have an `image/*` content type.

Only necessary headers such as `Accept`, `Range`, and the stable image-page
referrer should be forwarded. Renderer cookies and arbitrary headers must not
be forwarded.

## HTML parser choice

No HTML parser is currently installed.

### Add a small real parser

`parse5` is standards-oriented and relatively small, but requires explicit tree
walking. `node-html-parser` provides selectors and is more convenient, but adds
more package surface.

A parser dependency makes malformed markup and entity decoding much safer than
regular expressions and keeps extraction code testable.

### Use targeted regular expressions

This avoids a dependency but makes correctness depend on attribute order,
quoting, whitespace, and markup details. It is especially risky for URLs
embedded in CSS style attributes.

Recommendation: use a real parser, probably `parse5`, and keep selectors/tree
walking inside a small provider-private parsing module.

## Download decision

Individual downloads are enabled for the normal displayed rendition only. The
download path uses the same governed resource and explicit cache as viewing, so
it cannot bypass the two-second transfer gate, host validation, or request
policy.

Items retain stable page-number display names. After the resource responds, the
generic download boundary validates its content type and appends or corrects
the final supported extension before reserving the destination path. A
displayed WebP therefore becomes `Page 001.webp` rather than inheriting the
gallery's unrelated original JPG/PNG filename.

The provider does not follow the site's original-download path, request
archives, or imply that the downloaded bytes are originals. Collection
subfolders, persistent deduplication, bulk jobs, and downloads-list behavior
belong to the separate provider-aware download-manager proposal.

## Error behavior

Source-load errors can use the existing provider-neutral mapping:

- invalid canonical URL: `invalid-location`;
- invalid token or unavailable gallery: `not-found`;
- API/site throttling: `rate-limited`;
- network/timeout failure: `unavailable`;
- malformed metadata or HTML: `invalid-response`;
- zero images: `no-supported-media`.

Per-image quota exhaustion is less satisfactory. The current `<img>` error path
cannot read a typed provider error from the custom-protocol response, so it
would show the generic “Could not load Page N” state.

Options:

1. accept the generic per-media error for the MVP and log the specific 509
   reason in main;
2. design provider-neutral media error events so the viewer can display
   quota/rate-limit information.

Recommendation: use option 1 for the experiment and treat richer media errors
as a separate viewer capability.

## Thumbnail failure behavior

The filmstrip currently falls back from a failed thumbnail to loading full
media so it can capture a thumbnail. For E-Hentai, that could consume image
quota without an explicit user selection.

The provider prevents this behavior by returning a successful transparent
placeholder when thumbnail resolution or loading fails. The renderer therefore
does not enter its media-derived thumbnail capture path. A provider-neutral
capability is unnecessary unless another provider demonstrates a need for one.

## Verification requirements

Focused synthetic fixtures should cover:

- strict URL parsing and lookalike rejection;
- metadata validation;
- gallery index and image-page parsing;
- stable page-number item generation;
- lazy index-page lookup and in-flight deduplication;
- no eager full-media requests;
- rejection of unapproved page, thumbnail, and image hosts;
- range and request-cancellation propagation;
- timeout and provider error mapping;
- quota responses without automatic retries;
- a 2,000-item collection without 100 eager index requests.

Manual tests should use a deliberately selected public gallery and cover:

- first load;
- jumping far enough to require another index page;
- fast next/previous navigation;
- refresh;
- opening the gallery origin;
- invalid/unavailable gallery behavior;
- leaving the viewer open beyond a temporary direct URL's useful lifetime.

Real third-party gallery HTML and media should not be committed as test
fixtures. Tests should use minimal synthetic HTML representing only the
required structure.

## Decisions recorded for the experiment

1. Use lazy page-number items rather than eagerly enumerating filenames.
2. Allow individual normal-rendition downloads; keep original and bulk
   downloads disabled.
3. Parse provider HTML with `parse5`.
4. Keep the generic per-image failure temporarily, but treat explicit HTTP 509
   handling as required follow-up work.
5. Return provider-generated placeholder thumbnails when thumbnail work fails.
6. Admit at most twenty new thumbnail transfers per one-second window, with a
   maximum of twenty active transfers.

## Official references

- <https://ehwiki.org/wiki/API>
- <https://ehwiki.org/wiki/Gallery_FAQ>
- <https://ehwiki.org/wiki/My_Settings>
- <https://ehwiki.org/wiki/Making_Galleries>
- <https://ehwiki.org/wiki/Downloading>
- <https://ehwiki.org/wiki/Lo-Fi_Galleries>
