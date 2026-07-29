import type { CachedResource } from "../../../resourceCache/diskResourceCache";
import { mediaFileTypes } from "../../../utils/mediaTypes";

export const EHENTAI_USER_AGENT =
  "Pixvitta media viewer (+https://github.com/raulferrodrigues/pixvitta)";
export const EHENTAI_CONTROL_REQUEST_TIMEOUT_MS = 15_000;

const supportedImageContentTypes = new Set<string>(
  mediaFileTypes
    .filter((fileType) => fileType.kind === "image")
    .map((fileType) => fileType.mimeType)
);

export function createCachedResourceResponse(
  resource: CachedResource
): Response {
  const body = Uint8Array.from(resource.bytes).buffer;
  return new Response(body, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Content-Length": String(resource.bytes.byteLength),
      "Content-Type": resource.contentType,
      "Cross-Origin-Resource-Policy": "cross-origin"
    }
  });
}

export async function readImageResource(
  response: Response,
  source: string
): Promise<CachedResource> {
  const contentType = response.headers
    .get("Content-Type")
    ?.split(";")[0]
    .trim()
    .toLowerCase();
  if (!contentType || !supportedImageContentTypes.has(contentType)) {
    throw new Error(
      `${source} returned an unsupported image type: ${contentType ?? "unknown"}.`
    );
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0) {
    throw new Error(`${source} returned an empty image.`);
  }
  return { bytes, contentType };
}
