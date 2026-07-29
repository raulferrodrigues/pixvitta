# Background Downloads Redesign

## Status

Foundation implementation approved. This document belongs to draft PR #15.

The download implementation abandoned before this PR is not a starting point.
Its code and detailed product decisions are deliberately excluded. Draft PR #4
and the abandoned planning notes were read only to recover the useful request
broker concept described below.

## Goal

First implement the shared broker and full-file session cache that viewing and
future downloads will use. Actual download jobs remain deferred.

Future downloads will be main-process work that can continue independently of
the currently selected media while remaining subject to every provider's
request, quota, authorization, and resource-validation rules.

## Retained architectural idea

Pixvitta needs a shared request-admission seam for provider traffic. A download
must not obtain a URL and call the network transport independently of the
provider path used by viewing.

The useful broker idea is:

- providers declare governed request policies rather than scattering delays
  through individual call sites;
- policy state remains stable long enough that reopening a provider or
  receiving a short-lived media URL cannot reset a pacing boundary;
- callers describe the intent of queued work so interactive requests can be
  admitted before speculative or bulk background work;
- queued matching acquisitions can be promoted when a higher-priority caller
  joins them;
- a broker-wide HTTP 429 condition terminally stops provider traffic for the
  current process;
- download jobs ask a provider for authorized work, while the provider remains
  authoritative about whether and when its network request may start.

This is an architectural direction, not approval of the abandoned broker's
implementation or its exact policy model.

## Broker boundary

The broker owns:

- request admission time;
- one serial worker per policy;
- ordering between waiting request intents;
- promotion of queued work;
- terminal abort after HTTP 429;
- enough state to prevent provider recreation from bypassing a limit.

The broker must not own:

- provider URLs, authentication, cookies, or request headers;
- host and redirect authorization;
- response parsing or media validation;
- download destination paths or filenames;
- cache identity or eviction;
- download job lifecycle or renderer presentation;
- provider-specific interpretation of quota and throttle responses.

HTTP 429 has broker-wide terminal meaning. E-Hentai HTTP 509 remains
provider-specific: it blocks later uncached full-image work for the rest of the
session while cached images, metadata, and thumbnails remain usable.

## Existing provider constraints to preserve while planning

These are current Pixvitta rules, not newly chosen broker defaults:

- 4chan API and full-media calls use independent serial policies with a
  one-second delay after complete response handling; a thread is not refreshed
  more often than every 10 seconds.
- E-Hentai normal displayed-image transfers are serialized with at least two
  seconds after complete response handling.
- E-Hentai gallery and image-page requests use a one-second delay, and
  thumbnail requests use a 200-millisecond delay.
- E-Hentai original and force-reload paths must not be used implicitly.
- E-Hentai HTTP 509 must stop automatic background full-image work rather than
  trigger retries.
- E-Hentai thumbnail traffic currently has a separate policy from displayed
  images because the project has no official numeric thumbnail limit to rely
  on.

Before changing or extending any network behavior, the relevant provider rules
and official sources must be checked again. Pixvitta must not probe a service to
discover an unpublished threshold.

## Product decisions

The deferred first download release will:

- support individual downloads only;
- keep active work alive across source navigation, but not app restart;
- use the operating system Downloads directory;
- reserve collision-free numbered filenames;
- join duplicate active work;
- create a numbered copy when the user downloads the same completed item
  again;
- add no download-manager UI.

The current download button, IPC, renderer state, provider capability, and
context-menu download action are removed during the foundation implementation.
The later download design starts from the broker and cache rather than keeping
the old implementation dormant.

Every remote image, thumbnail, and video is downloaded to the session cache in
full before a provider returns it to Chromium. Videos begin playing only after
the complete file is committed and then seek through local byte-range
responses. A future explicit download joins an in-progress full-file
acquisition or copies the already committed cache file.
## Broker design decisions

Detailed broker decisions are maintained in
`docs/request-broker-plan.md`. Diagnostics are deferred and are not part of
the foundation implementation.

## Foundation implementation

The approved foundation work:

1. Implements the process-wide request broker with `request` and `promote`.
2. Implements the process-wide session cache with `find`, `writeStream`, and
   `writeFile`.
3. Gives 4chan policies of 1000 ms for API work and 1000 ms for full media.
4. Gives E-Hentai policies of 5000 ms for metadata, 1000 ms for pages, 2000 ms
   for full images, and 200 ms for thumbnails.
5. Migrates every 4chan and E-Hentai request to the broker.
6. Fully caches remote images, thumbnails, and videos before use.
7. Propagates high selected-media, normal thumbnail, and low prefetch
   priorities.
8. Removes the existing download feature and its dormant contracts.
9. Creates no replacement automated tests; the resulting behavior is manually
   tested.

## Decision log

- 2026-07-27: Restarted from `dev`; no abandoned download code was reused.
- 2026-07-27: Retained the provider-governed request broker as an architectural
  direction, without retaining its implementation or exact policies.
- 2026-07-29: Chose one main-process request-broker singleton with independent
  provider-policy schedulers. Its public operations are `request` and
  `promote`.
- 2026-07-29: Chose strict high, normal, and low lanes within each policy.
  Selected media is high, thumbnails are normal, and media prefetch and
  background downloads are low. A caller can promote matching queued work.
- 2026-07-29: Viewing and background downloads share completed cache entries
  and in-progress provider acquisitions.
- 2026-07-29: Chose globally unique string policy IDs whose queue state lasts
  for the main-process session. Added initial broker and cache signatures and
  the per-policy queue-loop scaffold.
- 2026-07-29: Chose a session-only full-file cache. A provider returns remote
  media only after the complete file is committed; cached videos then use
  local range responses.
- 2026-07-29: Finalized policy delays: 4chan API and media 1000 ms; E-Hentai
  metadata 5000 ms, pages 1000 ms, images 2000 ms, and thumbnails 200 ms.
- 2026-07-29: Deferred actual download jobs and chose to remove the existing
  download UI and contracts before implementing the broker/cache foundation.
