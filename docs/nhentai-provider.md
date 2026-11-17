# nhentai Gallery Provider

## Status

Implemented as an anonymous, read-only gallery provider. Verified against
synthetic fixtures. The live API was inspected by hand on November 1, 2026,
with a few single requests.

## Goal

Allow a user to paste an nhentai gallery URL into Pixvitta and view the gallery
through the existing provider-neutral media library, like E-Hentai and 4chan.

React gains no nhentai-specific behavior. URL parsing, API requests, CDN
selection, request pacing, and validation stay in main.

## External behavior (as of November 1, 2026)

### The official v2 API is documented

nhentai publishes a REST API at `https://nhentai.net/api/v2/` with an OpenAPI
description at `/api/v2/openapi.json`, Swagger UI at `/api/v2/docs`, and a
changelog at `/api/v2/changelog`. The legacy `/api/gallery/{id}` endpoint now
returns `403` with the text "Use new API https://nhentai.net/api/v2/docs".

The API asks every client to send a descriptive User-Agent shaped like
`AppName/version (contact or project URL)`.

### The gallery detail endpoint returns everything needed

`GET /api/v2/galleries/{gallery_id}` returns:

- `id`, `media_id`, `upload_date` (Unix seconds), `num_pages`;
- `title.english`, `title.japanese`, `title.pretty`;
- `pages[]`, each with `number`, `path`, `width`, `height`, `thumbnail`,
  `thumbnail_width`, `thumbnail_height`.

Paths are relative, for example `galleries/9/1.jpg` and `galleries/9/1t.jpg`.
Some live paths carry a doubled extension, such as `galleries/4289548/2t.webp.webp`,
and the CDN serves them as returned.
Unlike E-Hentai, one request returns the complete ordered page list. No HTML
parsing, lazy index pages, or placeholder enumeration is needed.

`404` means the gallery does not exist. `429` means the client is rate-limited.
The old separate `/pages` endpoints were removed in April 2026.

### CDN servers come from the API

`GET /api/v2/cdn` returns `image_servers` and `thumb_servers`, for example
`https://i1.nhentai.net` through `i4` and `t1` through `t4`. The documentation
says:

- do not hardcode subdomains; the list can change;
- use each `path` exactly as returned and concatenate it with a server;
- never construct paths by guessing extensions, suffixes, or numbering; the
  CDN rejects unknown routes and repeated invalid URLs lead to an extended ban;
- normal browsing rates are generous, and brief bursts such as a gallery's
  thumbnails are absorbed;
- sustained rates well beyond normal browsing get a short, self-expiring ban;
- treat `429` as a backoff signal;
- do not reconstruct full-gallery archives by walking page URLs; use the
  authenticated `POST /galleries/{id}/download` endpoint instead.

### Published rate limits

| Endpoint | Anonymous | API key |
| --- | --- | --- |
| `GET /api/v2/galleries/{id}` | 20/min per IP | 45/min per IP |
| `GET /api/v2/cdn` | none published | none published |
| CDN images and thumbnails | none published ("generous for normal browsing") | same |

Since May 2026, anonymous callers have stricter limits that "may get stricter
still". `429` responses include rate-limit headers and do not count against
the window.

### robots.txt

`robots.txt` disallows `/random`, `/search`, `/login`, `/register`, `/users/*`,
`/g/*/*/` (reader pages), `/g/*/edit`, and `/g/*/download`. The provider never
requests these HTML pages. It reads only the documented API and CDN. Reader
page URLs are used only as links the user may open in their browser.

## Scope

- Galleries opened from a pasted `https://nhentai.net/g/{id}/` URL.
- A reader URL `https://nhentai.net/g/{id}/{page}/` opens the same gallery and
  selects that page.
- Anonymous access only. No API key, sign-in, favorites, comments, search,
  tags, related galleries, or archive downloads.
- Individual page downloads of the displayed image through the existing
  download capability. "Download collection" is hidden and refused in main
  (`canDownloadCollection: false`), because nhentai asks clients not to rebuild
  galleries by walking page URLs.
- Refresh and "Open in browser" through the existing capabilities.

## Decisions

1. **Use the v2 API, anonymously.** One gallery request costs one unit of the
   20/min anonymous budget. Pixvitta opens galleries at human speed, so the
   anonymous tier is enough. API-key support is deferred until nhentai tightens
   anonymous limits or users ask for it. When added, it should store the key
   through `safeStorage` and send `Authorization: Key …`.
2. **Load the whole gallery from one request.** Items are known exactly. No
   lazy index pages or placeholder items are needed.
3. **Use CDN paths verbatim.** The provider joins a server from `/api/v2/cdn`
   with the returned `path`. It never derives a path from `media_id`, page
   numbers, or extensions. A page whose path fails validation is skipped,
   not repaired. A page whose thumbnail path fails validation keeps its image
   and shows no thumbnail.
4. **Fetch the CDN configuration once per session.** It is cached in memory
   for one hour and requested again when stale or after a failure. A gallery
   load fetches it only when no fresh copy exists.
5. **Spread pages across servers deterministically.** Page `n` uses
   `servers[(n - 1) % servers.length]`, so a page always maps to the same
   server within a configuration and work is spread like a normal reader.
   Cache keys use the path, not the server, so a configuration change does not
   invalidate cached files.
6. **Name items `Page 001.jpg`.** Names come from the page number plus the
   extension in the returned path, padded to at least three digits, matching
   the E-Hentai naming.
7. **Cache gallery details for the app session.** Reopening a gallery from
   recents reuses the cached detail. Refresh always requests it again.
8. **Use the shared provider runtime.** Media and thumbnails go through
   `ProviderCollectionRuntime`, so selection, prefetch, sharing, cancellation,
   and the session resource cache behave like the other remote providers.

## Request policies

All requests go through the process-wide request broker, so any `429` halts
every provider and quits Pixvitta, as for the other providers.

| Policy | Requests | Minimum spacing | Reason |
| --- | --- | --- | --- |
| `nhentai:api` | gallery detail, CDN config | 3,000 ms | 20/min anonymous limit |
| `nhentai:images` | full pages | 1,000 ms | well below "normal browsing" |
| `nhentai:thumbnails` | page thumbnails | 200 ms | documented thumbnail bursts are absorbed |

The runtime's prefetch (five ahead, five behind, then fifteen more ahead at low
priority) runs inside the image policy. A reader therefore never exceeds one
full image per second, even while skipping quickly.

## Security boundary

- Gallery URLs: exact `https://nhentai.net`, no port or credentials,
  `/g/{id}/` or `/g/{id}/{page}/`. The query and fragment are ignored.
- CDN servers: HTTPS origins on a subdomain of `nhentai.net`, with no port,
  credentials, path, query, or fragment. Invalid entries are dropped. If none
  remain, the load fails as `invalid-response`.
- Paths: relative `galleries/{media_id}/{file}`, where `{media_id}` matches the
  gallery's `media_id`, the file name is safe characters in dot-separated,
  non-empty parts, and the final extension is a supported image type. Paths are never rewritten.
- Responses: no redirects, and media responses must have a supported image
  content type.
- Only `Accept` and `User-Agent` headers are sent. No cookies or credentials.

## Error mapping

- Unparseable or non-gallery URL: `invalid-location`.
- `404`: `not-found`.
- `429`: broker halt (app quits).
- `403` or other non-success status, network failure, or timeout: `unavailable`.
- Malformed JSON, mismatched ID, or no usable CDN servers: `invalid-response`.
- No valid pages: `no-supported-media`.

## Verification

Focused tests, with synthetic payloads and no live requests, cover:

- URL parsing, canonicalization, page selection, and lookalike rejection;
- gallery payload validation, path validation, and item naming;
- CDN configuration validation and deterministic server selection.

Manual checks: open a gallery, open a reader URL for a later page, navigate
quickly, refresh, open in browser, download one page, and open a missing
gallery.

## Deferred

- API-key authentication, as a `ProviderAccount` (see
  [Accounts](media-provider-architecture.md#accounts)).
- Archive downloads through `POST /galleries/{id}/download`, which needs an
  API key and would fit the collection-download flow.
- Retrying a page on another CDN server after a failure.

## References

- <https://nhentai.net/api/v2/docs>
- <https://nhentai.net/api/v2/openapi.json>
- <https://nhentai.net/api/v2/changelog>
- <https://nhentai.net/robots.txt>
