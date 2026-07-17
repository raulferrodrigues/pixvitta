import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { mediaContentTypeFor } from "../utils/mediaTypes";

/*
 * These helpers turn local media files into Fetch Response objects for Electron
 * custom protocols. They act like a small static file server: content type,
 * length, CORS for renderer access, and byte ranges for video seeking.
 */

type ByteRange = {
  start: number;
  end: number;
};

// Video elements often request byte ranges so they can seek without reading the
// entire file. This parser supports the single-range forms Chromium sends, such
// as "bytes=100-" or "bytes=100-999".
function parseRangeHeader(rangeHeader: string | null, size: number): ByteRange | null {
  if (!rangeHeader) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match) return null;

  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) return null;

  if (!rawStart) {
    const suffixLength = Number(rawEnd);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
    const start = Math.max(size - suffixLength, 0);
    return { start, end: size - 1 };
  }

  const start = Number(rawStart);
  const end = rawEnd ? Number(rawEnd) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= size) {
    return null;
  }

  return {
    start,
    end: Math.min(end, size - 1)
  };
}

// Response bodies use the Web Streams shape because protocol.handle returns
// standard Fetch Response objects. Node streams are converted at the edge.
function streamBody(filePath: string, range?: ByteRange): BodyInit {
  const stream = range
    ? createReadStream(filePath, { start: range.start, end: range.end })
    : createReadStream(filePath);
  return Readable.toWeb(stream) as BodyInit;
}

export async function createMediaFileResponse(filePath: string, headers: Headers): Promise<Response> {
  const details = await stat(filePath);
  const size = details.size;
  const contentType = mediaContentTypeFor(filePath);
  const commonHeaders = {
    "Accept-Ranges": "bytes",
    "Access-Control-Allow-Origin": "*",
    "Cross-Origin-Resource-Policy": "cross-origin",
    "Content-Type": contentType
  };

  const range = parseRangeHeader(headers.get("Range"), size);
  if (headers.get("Range") && !range) {
    // 416 tells Chromium the requested byte range is not satisfiable and reports
    // the valid total size. This is the same contract an HTTP media server uses.
    return new Response(null, {
      status: 416,
      headers: {
        ...commonHeaders,
        "Content-Range": `bytes */${size}`
      }
    });
  }

  if (range) {
    // 206 Partial Content is what makes seeking in larger videos work without
    // loading the entire asset up front.
    return new Response(streamBody(filePath, range), {
      status: 206,
      headers: {
        ...commonHeaders,
        "Content-Length": String(range.end - range.start + 1),
        "Content-Range": `bytes ${range.start}-${range.end}/${size}`
      }
    });
  }

  return new Response(streamBody(filePath), {
    status: 200,
    headers: {
      ...commonHeaders,
      "Content-Length": String(size)
    }
  });
}
