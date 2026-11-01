import { getMediaFileType } from "../../../utils/mediaTypes";
import { ProviderError } from "../provider";

const SITE_HOST = "nhentai.net";
const SITE_ORIGIN = `https://${SITE_HOST}`;
const FILE_NAME_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9]+$/;

export type NHentaiGalleryReference = {
  galleryId: string;
  pageNumber: number | null;
  pageUrl: string;
  apiUrl: string;
};

export type NHentaiPage = {
  number: number;
  name: string;
  path: string;
  thumbnailPath: string;
  readerUrl: string;
};

export type NHentaiGallery = {
  galleryId: string;
  title: string;
  uploadedMs: number;
  pages: NHentaiPage[];
};

export type NHentaiCdnServers = {
  imageServers: string[];
  thumbnailServers: string[];
};

export function isNHentaiLocation(input: string): boolean {
  try {
    return new URL(input.trim()).hostname === SITE_HOST;
  } catch {
    return false;
  }
}

/**
 * Accepts gallery and reader URLs. The query and fragment carry nothing the
 * provider needs, so they are dropped from the canonical location.
 */
export function parseNHentaiGalleryUrl(
  input: string
): NHentaiGalleryReference | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== SITE_HOST ||
    url.port ||
    url.username ||
    url.password
  ) {
    return null;
  }

  const match = /^\/g\/([1-9]\d{0,9})(?:\/([1-9]\d{0,5}))?\/?$/.exec(
    url.pathname
  );
  if (!match) return null;
  const [, galleryId, page] = match;
  return {
    galleryId,
    pageNumber: page ? Number(page) : null,
    pageUrl: `${SITE_ORIGIN}/g/${galleryId}/`,
    apiUrl: `${SITE_ORIGIN}/api/v2/galleries/${galleryId}`
  };
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * CDN paths are used exactly as returned. A path that does not belong to the
 * gallery's media folder or is not a supported image is rejected, never
 * rewritten, because the CDN bans clients that request guessed URLs.
 */
function validImagePath(value: unknown, mediaId: string): string | null {
  if (typeof value !== "string") return null;
  const prefix = `galleries/${mediaId}/`;
  if (!value.startsWith(prefix)) return null;
  const fileName = value.slice(prefix.length);
  if (!FILE_NAME_PATTERN.test(fileName)) return null;
  return getMediaFileType(fileName)?.kind === "image" ? value : null;
}

export function parseNHentaiGallery(
  reference: NHentaiGalleryReference,
  payload: unknown
): NHentaiGallery {
  if (!payload || typeof payload !== "object") {
    throw new ProviderError("invalid-response", "The gallery response was not an object.");
  }
  const gallery = payload as Record<string, unknown>;
  if (gallery.id !== Number(reference.galleryId)) {
    throw new ProviderError("invalid-response", "The gallery response was for another gallery.");
  }
  const mediaId = nonEmptyString(gallery.media_id);
  if (!mediaId || !/^\d+$/.test(mediaId) || !Array.isArray(gallery.pages)) {
    throw new ProviderError("invalid-response", "The gallery response was incomplete.");
  }

  const titles =
    gallery.title && typeof gallery.title === "object"
      ? (gallery.title as Record<string, unknown>)
      : {};
  const title =
    nonEmptyString(titles.english) ??
    nonEmptyString(titles.pretty) ??
    nonEmptyString(titles.japanese) ??
    `nhentai gallery ${reference.galleryId}`;
  const uploadedSeconds = gallery.upload_date;

  const seen = new Set<number>();
  const valid = gallery.pages.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const page = entry as Record<string, unknown>;
    const path = validImagePath(page.path, mediaId);
    const thumbnailPath = validImagePath(page.thumbnail, mediaId);
    if (!isPositiveInteger(page.number) || seen.has(page.number) || !path || !thumbnailPath) {
      return [];
    }
    seen.add(page.number);
    return [{ number: page.number, path, thumbnailPath }];
  });
  if (valid.length === 0) {
    throw new ProviderError("no-supported-media", "The gallery does not contain supported images.");
  }
  valid.sort((left, right) => left.number - right.number);

  const nameWidth = Math.max(3, String(valid[valid.length - 1].number).length);
  return {
    galleryId: reference.galleryId,
    title,
    uploadedMs:
      typeof uploadedSeconds === "number" && Number.isFinite(uploadedSeconds) && uploadedSeconds > 0
        ? uploadedSeconds * 1_000
        : 0,
    pages: valid.map((page) => ({
      ...page,
      name: `Page ${String(page.number).padStart(nameWidth, "0")}${getMediaFileType(page.path)?.extension}`,
      readerUrl: `${reference.pageUrl}${page.number}/`
    }))
  };
}

function validServer(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const valid =
    url.protocol === "https:" &&
    url.hostname.endsWith(`.${SITE_HOST}`) &&
    !url.port &&
    !url.username &&
    !url.password &&
    url.pathname === "/" &&
    !url.search &&
    !url.hash;
  return valid ? url.origin : null;
}

export function parseNHentaiCdnServers(payload: unknown): NHentaiCdnServers {
  const config =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : {};
  const servers = (value: unknown) =>
    Array.isArray(value)
      ? value.flatMap((entry) => validServer(entry) ?? [])
      : [];
  const imageServers = servers(config.image_servers);
  const thumbnailServers = servers(config.thumb_servers);
  if (imageServers.length === 0 || thumbnailServers.length === 0) {
    throw new ProviderError("invalid-response", "The CDN configuration had no usable servers.");
  }
  return { imageServers, thumbnailServers };
}

/** Pages map to a stable server so work spreads like a normal reader. */
export function cdnUrl(
  servers: readonly string[],
  pageNumber: number,
  path: string
): string {
  return `${servers[(pageNumber - 1) % servers.length]}/${path}`;
}
