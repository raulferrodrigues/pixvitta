import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { readFile } from "node:fs/promises";
import { defaultSettings } from "../../../../shared/settings";
import { broker } from "../../../requestBroker";
import { cache } from "../../../resourceCache";
import { EHentaiProvider } from "./index";
import { GalleryAuthentication } from "./galleryAccess";
import { exHentaiSite } from "./gallerySite";
import { PAGES_POLICY, THUMBNAILS_POLICY } from "./requestPolicies";

function galleryIndex(first: number): string {
  const grid = Array.from({ length: 20 }, (value, index) => {
    const page = first + index;
    return `<a href="/s/abcdef/42-${page}"><div style="background:url(https://s.exhentai.org/thumb/${page}.jpg)"></div></a>`;
  }).join("");
  return `<div id="gdt">${grid}</div><div class="comment"><a href="/s/abcdef/42-100">See page 100</a></div>`;
}

test("gallery pagination, queued downloads, and cache hits remain bound to their account", async () => {
  const authentication = new GalleryAuthentication();
  let account = "A";
  const sent: Array<{ account: string; url: string }> = [];
  const fetch = async (request: Request) => {
    sent.push({ account, url: request.url });
    const url = new URL(request.url);
    if (url.pathname.endsWith("api.php")) {
      return new Response(JSON.stringify({ gmetadata: [{ title: "Gallery", filecount: 100, posted: 0 }] }));
    }
    if (url.pathname.startsWith("/g/")) {
      return new Response(galleryIndex(Number(url.searchParams.get("p") ?? 0) * 20 + 1));
    }
    if (url.pathname.startsWith("/s/")) {
      return new Response(`<img id="img" src="https://images.hath.network/${account}.jpg">`);
    }
    return new Response(account, { headers: { "Content-Type": "image/jpeg" } });
  };
  const provider = new EHentaiProvider({
    ...exHentaiSite,
    prepare: async () => authentication.capture(account, fetch)
  });
  const load = () => provider.load({
    location: "https://exhentai.org/g/42/abcdef1234/",
    refresh: false,
    settings: defaultSettings
  });
  const request = () => new Request("pixvitta-media://media/page?intent=download");
  const oldGallery = await load();
  const oldItem = oldGallery.items[40];
  assert.equal(await (await oldItem.media.respond(request(), "low")).text(), "A");
  assert.ok(sent.some(({ url }) => url.endsWith("?p=2")));
  assert.equal(oldItem.thumbnail.kind, "resource");
  if (oldItem.thumbnail.kind !== "resource") throw new Error("Missing thumbnail resource.");
  assert.equal(await (await oldItem.thumbnail.resource.respond(request(), "normal")).text(), "A");

  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const blockers = [PAGES_POLICY, THUMBNAILS_POLICY].map((policy) => {
    let start!: () => void;
    const started = new Promise<void>((resolve) => { start = resolve; });
    const task = broker.request({
      policy,
      priority: "high",
      request: new Request("https://example.invalid/blocked"),
      fetch: async () => { start(); return new Response(null); },
      handleResponse: async () => blocked
    });
    return { task, started };
  });
  await Promise.all(blockers.map(({ started }) => started));
  const queuedImage = oldGallery.items[0].media.respond(request(), "low");
  const queuedThumbnail = oldGallery.items[0].thumbnail;
  if (queuedThumbnail.kind !== "resource") throw new Error("Missing thumbnail resource.");
  const pendingThumbnail = queuedThumbnail.resource.respond(request(), "normal");
  await setImmediate();
  const beforeChange = sent.length;
  authentication.invalidate();
  account = "B";
  release();
  await Promise.all(blockers.map(({ task }) => task.result));
  assert.equal((await queuedImage).status, 409);
  assert.equal((await pendingThumbnail).headers.get("Content-Type"), "image/gif");
  assert.equal((await oldItem.media.respond(request(), "low")).status, 409);
  assert.equal((await oldItem.thumbnail.resource.respond(request(), "normal")).headers.get("Content-Type"), "image/gif");
  assert.equal(sent.length, beforeChange);
  assert.equal(await cache.find("exhentai:A:image:42:abcdef:1"), null);

  const newGallery = await load();
  assert.equal(await (await newGallery.items[40].media.respond(request(), "low")).text(), "B");
  const fileA = await cache.find("exhentai:A:image:42:abcdef:41");
  const fileB = await cache.find("exhentai:B:image:42:abcdef:41");
  assert.ok(fileA);
  assert.ok(fileB);
  assert.notEqual(fileA.filePath, fileB.filePath);
  assert.equal(await readFile(fileA.filePath, "utf8"), "A");
  assert.equal(await readFile(fileB.filePath, "utf8"), "B");
});
