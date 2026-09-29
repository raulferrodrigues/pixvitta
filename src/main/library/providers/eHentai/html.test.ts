import assert from "node:assert/strict";
import test from "node:test";
import { parseGalleryImagePages } from "./html";
import { parseEHentaiGalleryUrl } from "./galleryUrl";
import { eHentaiSite, exHentaiSite } from "./gallerySite";

test("gallery URL parsing keeps the two sites separate", () => {
  const exUrl = "https://exhentai.org/g/42/ABCDEF1234/";
  assert.equal(
    parseEHentaiGalleryUrl(exUrl, exHentaiSite)?.pageUrl,
    "https://exhentai.org/g/42/abcdef1234/"
  );
  assert.equal(parseEHentaiGalleryUrl(exUrl, eHentaiSite), null);
  for (const rejected of [
    "http://exhentai.org/g/42/abcdef1234/",
    "https://exhentai.org.evil.test/g/42/abcdef1234/",
    "https://exhentai.org:8443/g/42/abcdef1234/",
    "https://exhentai.org/g/42/abcdef1234/?p=1"
  ]) {
    assert.equal(parseEHentaiGalleryUrl(rejected, exHentaiSite), null);
  }
});

test("ExHentai gallery pages accept only ExHentai image-page links", () => {
  const html = `
    <a href="https://exhentai.org/s/abcdef1234/42-1">
      <div style="background-image: url(https://s.exhentai.org/t/cover.jpg)"></div>
    </a>
    <a href="https://e-hentai.org/s/abcdef1234/42-2">wrong site</a>
    <a href="https://exhentai.org.evil.test/s/abcdef1234/42-3">lookalike</a>
  `;

  const pages = parseGalleryImagePages(
    html,
    "https://exhentai.org/g/42/0123456789/",
    "42",
    "https://exhentai.org"
  );

  assert.equal(pages.size, 1);
  assert.equal(pages.get(1)?.pageUrl, "https://exhentai.org/s/abcdef1234/42-1");
  assert.deepEqual(pages.get(1)?.thumbnail, {
    kind: "direct",
    url: "https://s.exhentai.org/t/cover.jpg"
  });
});

test("public gallery parsing keeps its existing E-Hentai host restriction", () => {
  const html = `
    <a href="https://e-hentai.org/s/abcdef1234/42-1">public</a>
    <a href="https://exhentai.org/s/abcdef1234/42-2">private</a>
  `;
  const pages = parseGalleryImagePages(
    html,
    "https://e-hentai.org/g/42/0123456789/",
    "42"
  );
  assert.deepEqual([...pages.keys()], [1]);
});
