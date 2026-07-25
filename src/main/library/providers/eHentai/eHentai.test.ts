import assert from "node:assert/strict";
import test from "node:test";
import type {
  CachedResource,
  ResourceCache
} from "../../../resourceCache/diskResourceCache";
import {
  parseDisplayedImageUrl,
  parseFirstImagePageUrl
} from "./html";
import { EHentaiImagePipeline } from "./imagePipeline";
import { parseEHentaiGalleryUrl } from ".";

class MemoryCache implements ResourceCache {
  readonly resources = new Map<string, CachedResource>();

  async read(key: string): Promise<CachedResource | null> {
    return this.resources.get(key) ?? null;
  }

  async write(key: string, resource: CachedResource): Promise<void> {
    this.resources.set(key, resource);
  }
}

test("recognizes canonical public gallery URLs and rejects lookalikes", () => {
  assert.deepEqual(
    parseEHentaiGalleryUrl(
      "https://e-hentai.org/g/2231376/a7584a5932/#first-image"
    ),
    {
      galleryId: "2231376",
      galleryToken: "a7584a5932",
      pageUrl: "https://e-hentai.org/g/2231376/a7584a5932/"
    }
  );
  assert.equal(
    parseEHentaiGalleryUrl(
      "https://e-hentai.org.evil.test/g/2231376/a7584a5932/"
    ),
    null
  );
  assert.equal(
    parseEHentaiGalleryUrl("https://e-hentai.org/g/not-an-id/a7584a5932/"),
    null
  );
  assert.equal(
    parseEHentaiGalleryUrl("https://e-hentai.org/g/2231376/short/"),
    null
  );
});

test("extracts stable image-page and displayed-image URLs from HTML", () => {
  const galleryUrl = "https://e-hentai.org/g/2231376/a7584a5932/";
  assert.deepEqual(
    parseFirstImagePageUrl(
      `<html><body>
        <a href="https://e-hentai.org/s/1ff5e361bb/2231376-1">
          <img alt="first">
        </a>
      </body></html>`,
      galleryUrl,
      "2231376"
    ),
    {
      pageUrl: "https://e-hentai.org/s/1ff5e361bb/2231376-1",
      pageToken: "1ff5e361bb"
    }
  );
  assert.equal(
    parseDisplayedImageUrl(
      `<html><body>
        <img id="img" src="https://node.hath.network:1234/image.webp">
      </body></html>`,
      "https://e-hentai.org/s/1ff5e361bb/2231376-1"
    ),
    "https://node.hath.network:1234/image.webp"
  );
});

test("coalesces duplicate requests and starts cache misses at least two seconds apart", async () => {
  const cache = new MemoryCache();
  let currentTime = 0;
  const pageRequestTimes: number[] = [];
  const deliveryRequestTimes: number[] = [];
  const deliveryRequests: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.startsWith("https://e-hentai.org/s/")) {
      pageRequestTimes.push(currentTime);
      const pageNumber = url.endsWith("-1") ? "1" : "2";
      return new Response(
        `<img id="img" src="https://node.hath.network:1234/${pageNumber}.webp">`,
        { headers: { "Content-Type": "text/html" } }
      );
    }
    deliveryRequestTimes.push(currentTime);
    deliveryRequests.push(url);
    return new Response(new Uint8Array([1, 2, 3]).buffer, {
      headers: { "Content-Type": "image/webp" }
    });
  }) as typeof fetch;
  const pipeline = new EHentaiImagePipeline(cache, {
    fetchImpl,
    now: () => currentTime,
    wait: async (milliseconds) => {
      currentTime += milliseconds;
    },
    intervalMs: 2_000
  });

  const firstPage = "https://e-hentai.org/s/aaaaaaaaaa/123-1";
  const secondPage = "https://e-hentai.org/s/bbbbbbbbbb/123-2";
  const [first, duplicate, second] = await Promise.all([
    pipeline.get("first", firstPage),
    pipeline.get("first", firstPage),
    pipeline.get("second", secondPage)
  ]);

  assert.equal(pageRequestTimes.length, 2);
  assert.deepEqual(deliveryRequestTimes, [0, 2_000]);
  assert.deepEqual(deliveryRequests, [
    "https://node.hath.network:1234/1.webp",
    "https://node.hath.network:1234/2.webp"
  ]);
  assert.deepEqual(first.bytes, duplicate.bytes);
  assert.equal(second.contentType, "image/webp");

  await pipeline.get("first", firstPage);
  assert.equal(pageRequestTimes.length, 2, "cache hits must not resolve a delivery URL");
  assert.deepEqual(deliveryRequestTimes, [0, 2_000], "cache hits must not consume a slot");
});
