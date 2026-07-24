# 4chan Thread Viewer MVP

> Historical experiment notes. The implementation now lives as the 4chan
> provider inside the provider-neutral media library described in
> [Media Provider Architecture](media-provider-architecture.md).

This document tracks the Dev-only experiment for treating a 4chan thread as a
Pixvitta media folder. It is intentionally narrower than board browsing.

## MVP

- The folder picker accepts a full `https://boards.4chan.org/.../thread/...` or
  `https://boards.4channel.org/.../thread/...` URL.
- Pixvitta loads the thread through the official read-only JSON API and presents
  supported attachments in post order through the existing filmstrip and viewer.
- JPG, PNG, GIF, WebP, WebM, and MP4 attachments are accepted. Unsupported or
  deleted attachments are skipped.
- The full media and official thumbnails are loaded lazily from `i.4cdn.org`.
- Remote threads are not added to local recent folders.
- A source link remains visible while browsing a thread.

## API Policy

The implementation follows the published API rules:

- API calls are serialized and start no faster than one every 1.1 seconds.
- A thread is not refreshed more often than every 10 seconds.
- Cached threads are revalidated with `If-Modified-Since`.
- There is no polling in the MVP. Requests happen only when a user opens or
  manually refreshes a thread.
- Requests use HTTPS and a descriptive Pixvitta user agent.

References:

- [Official API documentation](https://github.com/4chan/4chan-API)
- [Thread endpoint](https://github.com/4chan/4chan-API/blob/master/pages/Threads.md)
- [User media URLs](https://github.com/4chan/4chan-API/blob/master/pages/User_images_and_static_content.md)

## Deliberate Limits

- No board catalog or thread-list browsing.
- No post text, poster metadata, replies, or thread composition UI.
- No automatic refresh.
- No downloads or local media caching.
- No remote-thread history.
- No special context menu for remote media.
- Thread ordering is fixed to API post order; local folder sort preferences do
  not apply.

## Possible Follow-ups

- Board catalog browsing with threads represented as folders.
- Remote-thread history and favorites.
- A quick-download action for the current media item.
- Thread status and update indicators.
- Better handling for expired or archived threads.
