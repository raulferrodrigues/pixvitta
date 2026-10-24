import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout } from "node:timers/promises";
import { ResourceAcquisitions } from "../../../providerRuntime";
import { createRequestBroker } from "../../../requestBroker/scheduler";
import type { BrokerRequestOptions, RequestBroker, RequestPriority } from "../../../requestBroker";
import { cache } from "../../../resourceCache";
import { GalleryAuthentication } from "./galleryAccess";
import { eHentaiSite } from "./gallerySite";
import { EHentaiRuntimeSession } from "./runtimeSession";

function indexHtml(gallery: string, first: number): string {
  return `<div id="gdt">${Array.from({ length: 20 }, (value, offset) => {
    const page = first + offset;
    return `<a href="/s/abcdef/${gallery}-${page}"><div style="background:url(https://ehgt.org/${page}.jpg)"></div></a>`;
  }).join("")}</div>`;
}

async function until(condition: () => boolean | Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 3000;
  while (!await condition() && Date.now() < deadline) await setTimeout(1);
  assert.equal(await condition(), true, "The expected gallery transfer did not finish.");
}

function setup(gallery: string, fetchImage?: (request: Request, page: number) => Promise<Response>) {
  const submitted: Array<{ url: string; priority: RequestPriority }> = [];
  const upstream: string[] = [];
  const fetch = async (request: Request): Promise<Response> => {
    upstream.push(request.url);
    const url = new URL(request.url);
    if (url.pathname.startsWith("/g/")) return new Response(indexHtml(gallery, Number(url.searchParams.get("p") ?? 0) * 20 + 1));
    if (url.pathname.startsWith("/s/")) {
      const page = Number(url.pathname.split("-").at(-1));
      return new Response(`<img id="img" src="https://images.hath.network/${page}.jpg">`);
    }
    const page = Number(url.pathname.slice(1).split(".")[0]);
    if (url.hostname === "images.hath.network" && fetchImage) return fetchImage(request, page);
    return new Response(`image-${page}`, { headers: { "Content-Type": "image/jpeg" } });
  };
  const transport = createRequestBroker({ fetch, wait: async () => {}, onRateLimit() { assert.fail("Unexpected rate limit."); } });
  const broker: RequestBroker = {
    ...transport,
    request<T>(options: BrokerRequestOptions<T>) {
      submitted.push({ url: options.request.url, priority: options.priority });
      return transport.request(options);
    }
  };
  const session = new EHentaiRuntimeSession({
    site: eHentaiSite,
    reference: { galleryId: gallery, galleryToken: "abcdef1234", pageUrl: `https://e-hentai.org/g/${gallery}/abcdef1234/` },
    fileCount: 100, cacheNamespace: `trial-${gallery}`,
    access: new GalleryAuthentication().capture("test", fetch),
    resources: new ResourceAcquisitions(broker),
    imageLimit: { reached: false, controller: new AbortController() }
  });
  return { session, submitted, upstream };
}

test("E-Hentai uses the shared window and serves cached downloads without more network requests", async () => {
  const { session, submitted, upstream } = setup("501");
  try {
    session.select("501:page:11");
    assert.equal(await (await session.respond(11, new Request("pixvitta-media://media/selected"), "high")).text(), "image-11");
    await until(async () => !!await cache.find("trial-501:image:501:abcdef:31"));
    const images = submitted.filter(({ url }) => new URL(url).hostname === "images.hath.network");
    assert.deepEqual(images.map(({ url }) => Number(new URL(url).pathname.slice(1).split(".")[0])), [11,12,13,14,15,16,10,9,8,7,6,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31]);
    assert.deepEqual(images.map(({ priority }) => priority), ["high", ...Array(10).fill("normal"), ...Array(15).fill("low")]);
    session.deactivate();
    const before = upstream.length;
    const response = await session.respond(12, new Request("pixvitta-media://media/download?intent=download", { headers: { Range: "bytes=0-4" } }), "low");
    assert.equal(response.status, 206);
    assert.equal(await response.text(), "image");
    assert.equal(upstream.length, before);
  } finally { session.deactivate(); }
});

test("a navigation jump aborts a blocking image stream without committing a partial cache file", async () => {
  let started = false;
  let aborted = false;
  const { session } = setup("502", async (request, page) => {
    if (page !== 1) return new Response(`image-${page}`, { headers: { "Content-Type": "image/jpeg" } });
    return new Response(new ReadableStream({
      start(controller) {
        started = true;
        controller.enqueue(new TextEncoder().encode("partial"));
        request.signal.addEventListener("abort", () => { aborted = true; controller.error(request.signal.reason); }, { once: true });
      }
    }), { headers: { "Content-Type": "image/jpeg" } });
  });
  try {
    session.select("502:page:1");
    const old = session.respond(1, new Request("pixvitta-media://media/old"), "high");
    await until(() => started);
    session.select("502:page:50");
    const selected = await session.respond(50, new Request("pixvitta-media://media/selected"), "high");
    assert.equal(await selected.text(), "image-50");
    assert.equal((await old).status, 409);
    assert.equal(aborted, true);
    assert.equal(await cache.find("trial-502:image:502:abcdef:1"), null);
  } finally { session.deactivate(); }
});

test("HTTP 509 stops further full-image work while thumbnails remain independent", async () => {
  const { session, upstream } = setup("503", async () => new Response(null, { status: 509 }));
  try {
    session.select("503:page:1");
    await assert.rejects(session.respond(1, new Request("pixvitta-media://media/selected"), "high"), /509/);
    const before = upstream.length;
    await assert.rejects(session.respond(2, new Request("pixvitta-media://media/download?intent=download"), "low"), /viewing limits/);
    assert.equal(upstream.length, before);
    const thumbnail = await session.respondThumbnail(2, new Request("pixvitta-media://thumbnail/page"), "normal");
    assert.equal(thumbnail.headers.get("Content-Type"), "image/jpeg");
    assert.equal(await thumbnail.text(), "image-2");
    assert.equal(upstream.filter((url) => new URL(url).hostname === "images.hath.network").length, 1);
  } finally { session.deactivate(); }
});
