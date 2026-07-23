import assert from "node:assert/strict";
import test from "node:test";
import { defaultSettings } from "../../../shared/settings";
import {
  createFourChanThreadCollection,
  FourChanProvider,
  parseFourChanThreadUrl
} from "./fourChan";

const threadUrl = "https://boards.4chan.org/gif/thread/123456/example-thread";
const payload = {
  posts: [
    {
      no: 123456,
      time: 1_700_000_000,
      tim: 1_700_000_000_001,
      filename: "first image",
      ext: ".jpg",
      fsize: 1024
    },
    {
      no: 123457,
      time: 1_700_000_001,
      tim: 1_700_000_000_002,
      filename: "animation",
      ext: ".webm",
      fsize: 2048
    }
  ]
};

test("parses supported thread URLs and rejects lookalikes", () => {
  assert.deepEqual(parseFourChanThreadUrl(`${threadUrl}#p123457`), {
    board: "gif",
    threadId: "123456",
    pageUrl: "https://boards.4chan.org/gif/thread/123456",
    apiUrl: "https://a.4cdn.org/gif/thread/123456.json"
  });
  assert.equal(
    parseFourChanThreadUrl("https://boards.4channel.org/g/thread/987654")?.board,
    "g"
  );
  assert.equal(parseFourChanThreadUrl("http://boards.4chan.org/gif/thread/123456"), null);
  assert.equal(parseFourChanThreadUrl("https://boards.4chan.org/gif/"), null);
  assert.equal(parseFourChanThreadUrl("https://boards.4chan.org.evil.test/gif/thread/123456"), null);
  assert.equal(parseFourChanThreadUrl("https://boards.4chan.org/gif/thread/123456?output=json"), null);
});

test("maps supported attachments in post order", () => {
  const reference = parseFourChanThreadUrl(threadUrl);
  assert.ok(reference);

  const collection = createFourChanThreadCollection(reference, {
    posts: [
      ...payload.posts,
      {
        no: 123458,
        time: 1_700_000_002,
        tim: 1_700_000_000_003,
        filename: "document",
        ext: ".pdf",
        fsize: 4096
      },
      {
        no: 123459,
        time: 1_700_000_003,
        tim: 1_700_000_000_004,
        filename: "deleted",
        ext: ".png",
        filedeleted: 1
      }
    ]
  });

  assert.equal(collection.canonicalLocation, "https://boards.4chan.org/gif/thread/123456");
  assert.equal(collection.origin?.label, "/gif/ · 4chan");
  assert.deepEqual(collection.items.map((item) => item.kind), ["image", "video"]);
  assert.deepEqual(collection.items.map((item) => item.name), ["first image.jpg", "animation.webm"]);
  assert.equal(collection.selectedKey, collection.items[0].key);
});

test("proxies media with provider referrer and byte ranges", async () => {
  const reference = parseFourChanThreadUrl(threadUrl);
  assert.ok(reference);
  let upstreamUrl = "";
  let upstreamHeaders = new Headers();
  const fetchImpl = (async (
    input: string | URL | Request,
    init?: RequestInit
  ) => {
    upstreamUrl = String(input);
    upstreamHeaders = new Headers(init?.headers);
    return new Response("media", {
      status: 206,
      headers: {
        "Accept-Ranges": "bytes",
        "Content-Range": "bytes 10-14/100",
        "Content-Type": "image/jpeg"
      }
    });
  }) as typeof fetch;
  const collection = createFourChanThreadCollection(
    reference,
    payload,
    fetchImpl
  );

  const response = await collection.items[0].media.respond(
    new Request("pixvitta-media://media/example", {
      headers: { Range: "bytes=10-14" }
    })
  );

  assert.equal(upstreamUrl, "https://i.4cdn.org/gif/1700000000001.jpg");
  assert.equal(upstreamHeaders.get("Referer"), reference.pageUrl);
  assert.equal(upstreamHeaders.get("Range"), "bytes=10-14");
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*");
});

test("caches thread responses, revalidates them, and serializes API requests", async () => {
  let now = 0;
  const waits: number[] = [];
  const requests: Headers[] = [];
  const responses = [
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Last-Modified": "Wed, 22 Jul 2026 12:00:00 GMT"
      }
    }),
    new Response(null, { status: 304 }),
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    })
  ];
  const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
    requests.push(new Headers(init?.headers));
    const response = responses.shift();
    assert.ok(response);
    return response;
  }) as typeof fetch;
  const provider = new FourChanProvider({
    fetchImpl,
    now: () => now,
    wait: async (milliseconds) => {
      waits.push(milliseconds);
      now += milliseconds;
    },
    requestIntervalMs: 1_000,
    threadRefreshMs: 10_000
  });

  const load = (location: string) =>
    provider.load({
      location,
      refresh: false,
      settings: defaultSettings
    });
  const first = await load(threadUrl);
  assert.equal((await load(threadUrl)), first);
  assert.equal(requests.length, 1);

  now = 11_000;
  assert.equal((await load(threadUrl)), first);
  assert.equal(requests[1].get("If-Modified-Since"), "Wed, 22 Jul 2026 12:00:00 GMT");

  const otherThread = "https://boards.4chan.org/gif/thread/123999";
  await load(otherThread);
  assert.deepEqual(waits, [1_000]);
  assert.equal(requests.length, 3);
});
