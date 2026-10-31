import assert from "node:assert/strict";
import test from "node:test";
import { GalleryAccessExpiredError, GalleryAuthentication } from "./galleryAccess";

test("queued requests cannot use cookies from a later account", async () => {
  const authentication = new GalleryAuthentication();
  const accounts: string[] = [];
  let account = "A";
  const fetch = async () => {
    accounts.push(account);
    return new Response(account);
  };
  const oldAccess = authentication.capture(account, fetch);
  authentication.invalidate();
  account = "B";
  const newAccess = authentication.capture(account, fetch);

  await assert.rejects(oldAccess.fetch(new Request("https://exhentai.org/")), GalleryAccessExpiredError);
  assert.throws(oldAccess.assertCurrent, GalleryAccessExpiredError);
  assert.equal(await (await newAccess.fetch(new Request("https://exhentai.org/"))).text(), "B");
  assert.deepEqual(accounts, ["B"]);
});

test("a response that arrives after sign-in starts is discarded", async () => {
  const authentication = new GalleryAuthentication();
  let complete!: (response: Response) => void;
  let cancelled = false;
  const access = authentication.capture("A", () => new Promise((resolve) => { complete = resolve; }));
  const pending = access.fetch(new Request("https://exhentai.org/"));
  authentication.invalidate();
  complete(new Response(new ReadableStream({ cancel() { cancelled = true; } })));

  await assert.rejects(pending, GalleryAccessExpiredError);
  assert.equal(cancelled, true);
});
