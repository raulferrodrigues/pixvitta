import assert from "node:assert/strict";
import test from "node:test";
import { ProviderError } from "../provider";
import {
  cdnUrl,
  parseNHentaiCdnServers,
  parseNHentaiGallery,
  parseNHentaiGalleryUrl
} from "./gallery";

function page(number: number, extension = "jpg") {
  return {
    number,
    path: `galleries/9/${number}.${extension}`,
    width: 1050,
    height: 1500,
    thumbnail: `galleries/9/${number}t.${extension}`,
    thumbnail_width: 200,
    thumbnail_height: 286
  };
}

function gallery(pages: unknown[]) {
  return {
    id: 1,
    media_id: "9",
    title: { english: "Full Title", japanese: null, pretty: "Pretty" },
    upload_date: 1_403_964_737,
    num_pages: pages.length,
    pages
  };
}

function assertProviderError(run: () => unknown, code: string) {
  assert.throws(run, (error) => error instanceof ProviderError && error.code === code);
}

const reference = parseNHentaiGalleryUrl("https://nhentai.net/g/1/")!;

test("gallery URLs canonicalize and keep a reader page selection", () => {
  assert.deepEqual(parseNHentaiGalleryUrl(" https://nhentai.net/g/177013 "), {
    galleryId: "177013",
    pageNumber: null,
    pageUrl: "https://nhentai.net/g/177013/",
    apiUrl: "https://nhentai.net/api/v2/galleries/177013"
  });
  const reader = parseNHentaiGalleryUrl("https://nhentai.net/g/177013/12/?ref=x#top");
  assert.equal(reader?.pageNumber, 12);
  assert.equal(reader?.pageUrl, "https://nhentai.net/g/177013/");

  for (const rejected of [
    "http://nhentai.net/g/1/",
    "https://nhentai.net.evil.test/g/1/",
    "https://evil.nhentai.net/g/1/",
    "https://nhentai.net:8443/g/1/",
    "https://user@nhentai.net/g/1/",
    "https://nhentai.net/g/0/",
    "https://nhentai.net/g/1/0/",
    "https://nhentai.net/g/1/2/3/",
    "https://nhentai.net/search/?q=1",
    "nhentai.net/g/1/"
  ]) {
    assert.equal(parseNHentaiGalleryUrl(rejected), null, rejected);
  }
});

test("gallery pages keep returned paths, order, and padded names", () => {
  const parsed = parseNHentaiGallery(reference, gallery([page(2, "png"), page(1), page(10, "webp")]));
  assert.equal(parsed.title, "Full Title");
  assert.equal(parsed.uploadedMs, 1_403_964_737_000);
  assert.deepEqual(
    parsed.pages.map(({ number, name, path, thumbnailPath, readerUrl }) => [
      number,
      name,
      path,
      thumbnailPath,
      readerUrl
    ]),
    [
      [1, "Page 001.jpg", "galleries/9/1.jpg", "galleries/9/1t.jpg", "https://nhentai.net/g/1/1/"],
      [2, "Page 002.png", "galleries/9/2.png", "galleries/9/2t.png", "https://nhentai.net/g/1/2/"],
      [10, "Page 010.webp", "galleries/9/10.webp", "galleries/9/10t.webp", "https://nhentai.net/g/1/10/"]
    ]
  );
});

test("pages with paths outside the gallery or unsupported types are skipped", () => {
  const parsed = parseNHentaiGallery(
    reference,
    gallery([
      page(1),
      { ...page(2), path: "galleries/10/2.jpg" },
      { ...page(3), path: "/galleries/9/3.jpg" },
      { ...page(4), path: "galleries/9/../4.jpg" },
      { ...page(5), path: "galleries/9/5.mp4" },
      { ...page(7), number: 1 },
      { ...page(8), number: "8" },
      null
    ])
  );
  assert.deepEqual(parsed.pages.map((entry) => entry.number), [1]);
});

test("doubled extensions are accepted and a bad thumbnail keeps the page", () => {
  const parsed = parseNHentaiGallery(
    reference,
    gallery([
      { ...page(1, "webp"), thumbnail: "galleries/9/1t.webp.webp" },
      { ...page(2), thumbnail: "galleries/9/../2t.jpg" }
    ])
  );
  assert.deepEqual(
    parsed.pages.map(({ name, path, thumbnailPath }) => [name, path, thumbnailPath]),
    [
      ["Page 001.webp", "galleries/9/1.webp", "galleries/9/1t.webp.webp"],
      ["Page 002.jpg", "galleries/9/2.jpg", null]
    ]
  );
});

test("gallery responses must match the request and contain images", () => {
  assertProviderError(() => parseNHentaiGallery(reference, null), "invalid-response");
  assertProviderError(() => parseNHentaiGallery(reference, { ...gallery([page(1)]), id: 2 }), "invalid-response");
  assertProviderError(() => parseNHentaiGallery(reference, { ...gallery([page(1)]), media_id: "../9" }), "invalid-response");
  assertProviderError(() => parseNHentaiGallery(reference, gallery([])), "no-supported-media");
  assert.equal(
    parseNHentaiGallery(reference, { ...gallery([page(1)]), title: {} }).title,
    "nhentai gallery 1"
  );
});

test("CDN configuration accepts only nhentai HTTPS origins", () => {
  const servers = parseNHentaiCdnServers({
    image_servers: [
      "https://i1.nhentai.net",
      "https://i2.nhentai.net/",
      "http://i3.nhentai.net",
      "https://nhentai.net.evil.test",
      "https://i4.nhentai.net:8443",
      "https://i5.nhentai.net/path",
      42
    ],
    thumb_servers: ["https://t1.nhentai.net"]
  });
  assert.deepEqual(servers, {
    imageServers: ["https://i1.nhentai.net", "https://i2.nhentai.net"],
    thumbnailServers: ["https://t1.nhentai.net"]
  });
  assertProviderError(
    () => parseNHentaiCdnServers({ image_servers: ["https://evil.test"], thumb_servers: ["https://t1.nhentai.net"] }),
    "invalid-response"
  );
});

test("pages map to a stable server and use the path verbatim", () => {
  const servers = ["https://i1.nhentai.net", "https://i2.nhentai.net"];
  assert.equal(cdnUrl(servers, 1, "galleries/9/1.jpg"), "https://i1.nhentai.net/galleries/9/1.jpg");
  assert.equal(cdnUrl(servers, 2, "galleries/9/2.jpg"), "https://i2.nhentai.net/galleries/9/2.jpg");
  assert.equal(cdnUrl(servers, 3, "galleries/9/3.jpg"), "https://i1.nhentai.net/galleries/9/3.jpg");
});
