import assert from "node:assert/strict";
import test from "node:test";
import { ProviderError } from "../provider";
import { parseEHentaiGalleryUrl } from "./galleryReference";
import { EHentaiMetadataClient } from "./metadataClient";
import { readImageResource } from "./network";

const galleryUrl = "https://e-hentai.org/g/123/abcdef1234/";

test("E-Hentai gallery references enforce the canonical safety boundary", () => {
  assert.deepEqual(parseEHentaiGalleryUrl(galleryUrl), {
    galleryId: "123",
    galleryToken: "abcdef1234",
    pageUrl: galleryUrl
  });
  assert.equal(
    parseEHentaiGalleryUrl(
      "https://e-hentai.org/g/9007199254740992/abcdef1234/"
    ),
    null
  );
  assert.equal(
    parseEHentaiGalleryUrl(`${galleryUrl}#page-1`),
    null
  );
});

test("E-Hentai metadata rejects gallery sizes outside the supported boundary", async () => {
  const reference = parseEHentaiGalleryUrl(galleryUrl);
  assert.ok(reference);

  const fetchImpl: typeof fetch = async () =>
    Response.json({
      gmetadata: [
        {
          title: "Too large",
          posted: "123",
          filecount: "2001"
        }
      ]
    });
  const client = new EHentaiMetadataClient(fetchImpl);

  await assert.rejects(
    () => client.load(reference),
    (error: unknown) =>
      error instanceof ProviderError && error.code === "invalid-response"
  );
});

test("E-Hentai image resources normalize MIME types before caching", async () => {
  const resource = await readImageResource(
    new Response(Uint8Array.of(1, 2, 3), {
      headers: { "Content-Type": "Image/WebP; charset=binary" }
    }),
    "Test image"
  );

  assert.equal(resource.contentType, "image/webp");
  assert.deepEqual(resource.bytes, Uint8Array.of(1, 2, 3));
});
