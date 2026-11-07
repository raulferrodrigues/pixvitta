import http from "node:http";
import type { AddressInfo } from "node:net";
import type { FakeWeb } from "../../src/main/testing/fakeWeb.ts";

/** Serves a FakeWeb over loopback HTTP: /<host>/<path> answers as https://<host>/<path>. */
export async function serveFakeWeb(web: FakeWeb): Promise<{ port: number; close(): Promise<void> }> {
  const server = http.createServer((incoming, outgoing) => {
    void respond(web, incoming, outgoing).catch((error: unknown) => {
      console.error("The fake web failed to answer.", error);
      outgoing.destroy();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: (server.address() as AddressInfo).port,
    close: () => new Promise((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    })
  };
}

async function respond(web: FakeWeb, incoming: http.IncomingMessage, outgoing: http.ServerResponse): Promise<void> {
  const headers = new Headers();
  for (const [name, value] of Object.entries(incoming.headers)) {
    if (typeof value === "string" && name !== "host" && name !== "connection") headers.set(name, value);
  }
  const response = await web.fetch(new Request(`https:/${incoming.url}`, { method: incoming.method, headers }));
  outgoing.writeHead(response.status, Object.fromEntries(response.headers));
  outgoing.end(Buffer.from(await response.arrayBuffer()));
}
