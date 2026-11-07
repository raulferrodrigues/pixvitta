import { deflateSync } from "node:zlib";

/*
 * FakeWeb is the one definition of "the internet" for every test layer. Flow
 * tests call it directly as the broker's fetch; E2E tests and `pnpm app` serve
 * it over HTTP (tests/support/fakeWebServer.ts). A route is the same in both.
 *
 * Unknown URLs get a 599 and land in `unexpected`, so a provider that starts
 * calling something new fails loudly instead of quietly reaching the real site.
 *
 * This file also runs under Node's native type stripping, through the driver,
 * so it sticks to erasable TypeScript and has no relative imports.
 */

export type RecordedRequest = {
  /** Arrival time, so E2E tests can measure real pacing on the wire. */
  atMs: number;
  url: string;
  host: string;
  method: string;
  userAgent: string | null;
  accept: string | null;
  range: string | null;
  ifModifiedSince: string | null;
  status: number;
};

export type FakeHandler = (request: Request) => Response | Promise<Response>;

type Waiter = {
  predicate: () => boolean;
  resolve: () => void;
};

export class FakeWeb {
  readonly requests: RecordedRequest[] = [];
  readonly unexpected: string[] = [];
  private readonly routes = new Map<string, FakeHandler>();
  private waiters: Waiter[] = [];

  /** Adds a route, or replaces one to change how a URL answers mid-test. */
  route(url: string, handler: FakeHandler): void {
    this.routes.set(this.routeKey(url), handler);
  }

  readonly fetch = async (request: Request): Promise<Response> => {
    const handler = this.routes.get(this.routeKey(request.url));
    if (!handler) this.unexpected.push(request.url);
    const entry: RecordedRequest = {
      atMs: Date.now(),
      url: request.url,
      host: new URL(request.url).hostname,
      method: request.method,
      userAgent: request.headers.get("user-agent"),
      accept: request.headers.get("accept"),
      range: request.headers.get("range"),
      ifModifiedSince: request.headers.get("if-modified-since"),
      status: 0
    };
    // Recorded on arrival, so a test can observe a request its handler holds.
    this.requests.push(entry);
    this.notify();
    const response = handler ? await handler(request) : new Response(null, { status: 599 });
    entry.status = response.status;
    this.notify();
    return response;
  };

  urls(host?: string): string[] {
    return this.requests
      .filter((request) => host === undefined || request.host === host)
      .map((request) => request.url);
  }

  /** Resolves when the condition holds, checked after every request and response. */
  waitFor(description: string, predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
    if (predicate()) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timed out waiting for ${description}. Requests so far:\n${this.urls().join("\n") || "(none)"}`));
      }, timeoutMs);
      this.waiters.push({
        predicate,
        resolve: () => {
          clearTimeout(timer);
          resolve();
        }
      });
    });
  }

  waitForRequest(url: string, timeoutMs?: number): Promise<void> {
    return this.waitFor(`a request to ${url}`, () => this.urls().includes(url), timeoutMs);
  }

  private notify(): void {
    const ready = this.waiters.filter((waiter) => waiter.predicate());
    this.waiters = this.waiters.filter((waiter) => !ready.includes(waiter));
    for (const waiter of ready) waiter.resolve();
  }

  private routeKey(url: string): string {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname}${parsed.search}`;
  }
}

/** A promise a route can hold open, to keep a request in flight while a test acts. */
export function createGate(): { wait: Promise<void>; open(): void } {
  let open!: () => void;
  const wait = new Promise<void>((resolve) => { open = resolve; });
  return { wait, open };
}

const crcTable = Array.from({ length: 256 }, (value, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(data.length, 0);
  header.write(type, 4, "ascii");
  const trailer = Buffer.alloc(4);
  trailer.writeUInt32BE(crc32(Buffer.concat([header.subarray(4), data])), 0);
  return Buffer.concat([header, data, trailer]);
}

/** A real, decodable PNG of one color. Tests can tell images apart by size. */
export function syntheticPng(width: number, height: number, rgb: readonly [number, number, number] = [80, 120, 200]): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const row = Buffer.alloc(1 + width * 3);
  for (let pixel = 0; pixel < width; pixel += 1) row.set(rgb, 1 + pixel * 3);
  const pixels = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(pixels)),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

function pngResponse(body: Buffer): Response {
  return new Response(new Uint8Array(body), {
    headers: { "Content-Type": "image/png", "Content-Length": String(body.length) }
  });
}

export type FakeThread = {
  /** What a person pastes into the app. */
  pageUrl: string;
  apiUrl: string;
  /** Full-size media URLs, in thread order. */
  mediaUrls: string[];
  thumbnailUrls: string[];
  /** Per-file PNG bytes, so downloads can be compared with what was served. */
  bodies: Buffer[];
};

const THREAD_LAST_MODIFIED = "Sun, 01 Nov 2026 12:00:00 GMT";

/** A 4chan thread with one PNG per post, served the way the real API serves it. */
export function addFourChanThread(
  web: FakeWeb,
  { threadId, files, subject = "Sample thread", board = "g" }: { threadId: number; files: number; subject?: string; board?: string }
): FakeThread {
  const stamp = (index: number) => threadId * 1_000 + index + 1;
  const bodies = Array.from({ length: files }, (value, index) => syntheticPng(40 + index, 30 + index));
  const posts = bodies.map((body, index) => ({
    no: threadId + index,
    time: 1_800_000_000 + index,
    tim: stamp(index),
    filename: `file-${index + 1}`,
    ext: ".png",
    fsize: body.length,
    ...(index === 0 ? { sub: subject } : {})
  }));
  const apiUrl = `https://a.4cdn.org/${board}/thread/${threadId}.json`;
  web.route(apiUrl, (request) =>
    request.headers.get("if-modified-since")
      ? new Response(null, { status: 304 })
      : new Response(JSON.stringify({ posts }), {
        headers: { "Content-Type": "application/json", "Last-Modified": THREAD_LAST_MODIFIED }
      })
  );
  const mediaUrls = bodies.map((body, index) => `https://i.4cdn.org/${board}/${stamp(index)}.png`);
  const thumbnailUrls = bodies.map((body, index) => `https://i.4cdn.org/${board}/${stamp(index)}s.jpg`);
  bodies.forEach((body, index) => {
    web.route(mediaUrls[index], () => pngResponse(body));
    // A PNG behind a .jpg URL, because the provider trusts Content-Type.
    web.route(thumbnailUrls[index], () => pngResponse(body));
  });
  return { pageUrl: `https://boards.4chan.org/${board}/thread/${threadId}`, apiUrl, mediaUrls, thumbnailUrls, bodies };
}

export type FakeGallery = {
  pageUrl: string;
  apiUrl: string;
  cdnUrl: string;
  mediaUrls: string[];
  thumbnailUrls: string[];
};

const NHENTAI_IMAGE_SERVER = "https://i1.nhentai.net";
const NHENTAI_THUMBNAIL_SERVER = "https://t1.nhentai.net";

/** An nhentai gallery of synthetic PNGs, plus the CDN configuration the provider reads. */
export function addNHentaiGallery(
  web: FakeWeb,
  { galleryId, pages }: { galleryId: number; pages: number }
): FakeGallery {
  const mediaId = String(galleryId * 10);
  const entries = Array.from({ length: pages }, (value, index) => {
    const number = index + 1;
    return {
      number,
      path: `galleries/${mediaId}/${number}.png`,
      width: 40,
      height: 30,
      thumbnail: `galleries/${mediaId}/${number}t.png`,
      thumbnail_width: 40,
      thumbnail_height: 30
    };
  });
  const apiUrl = `https://nhentai.net/api/v2/galleries/${galleryId}`;
  const cdnUrl = "https://nhentai.net/api/v2/cdn";
  web.route(apiUrl, () =>
    Response.json({
      id: galleryId,
      media_id: mediaId,
      title: { english: `Sample gallery ${galleryId}`, japanese: null, pretty: "Sample" },
      upload_date: 1_800_000_000,
      num_pages: pages,
      pages: entries
    })
  );
  web.route(cdnUrl, () =>
    Response.json({ image_servers: [NHENTAI_IMAGE_SERVER], thumb_servers: [NHENTAI_THUMBNAIL_SERVER] })
  );
  const mediaUrls = entries.map((entry) => `${NHENTAI_IMAGE_SERVER}/${entry.path}`);
  const thumbnailUrls = entries.map((entry) => `${NHENTAI_THUMBNAIL_SERVER}/${entry.thumbnail}`);
  for (const url of [...mediaUrls, ...thumbnailUrls]) {
    web.route(url, () => pngResponse(syntheticPng(40, 30)));
  }
  return { pageUrl: `https://nhentai.net/g/${galleryId}/`, apiUrl, cdnUrl, mediaUrls, thumbnailUrls };
}
