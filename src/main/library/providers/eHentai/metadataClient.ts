import { ProviderError } from "../provider";
import type { EHentaiGalleryReference } from "./galleryReference";
import {
  EHENTAI_CONTROL_REQUEST_TIMEOUT_MS,
  EHENTAI_USER_AGENT
} from "./network";

const API_URL = "https://api.e-hentai.org/api.php";
const MAX_GALLERY_FILE_COUNT = 2_000;

export type EHentaiGalleryMetadata = {
  title: string;
  postedMs: number;
  fileCount: number;
};

function parseMetadata(
  payload: unknown,
  reference: EHentaiGalleryReference
): EHentaiGalleryMetadata {
  if (!payload || typeof payload !== "object") {
    throw new ProviderError(
      "invalid-response",
      "Gallery metadata was not an object."
    );
  }

  const entries = (payload as { gmetadata?: unknown }).gmetadata;
  const entry = Array.isArray(entries) ? entries[0] : null;
  if (!entry || typeof entry !== "object") {
    throw new ProviderError(
      "invalid-response",
      "Gallery metadata did not contain a gallery."
    );
  }

  const metadata = entry as Record<string, unknown>;
  if (metadata.error) {
    throw new ProviderError("not-found", "The gallery is unavailable.");
  }

  const fileCount = Number(metadata.filecount);
  if (
    !Number.isSafeInteger(fileCount) ||
    fileCount < 1 ||
    fileCount > MAX_GALLERY_FILE_COUNT
  ) {
    throw new ProviderError(
      "invalid-response",
      "Gallery metadata contained an invalid file count."
    );
  }

  const postedSeconds = Number(metadata.posted);
  const candidatePostedMs = postedSeconds * 1_000;
  const postedMs =
    Number.isSafeInteger(postedSeconds) &&
    postedSeconds >= 0 &&
    Number.isSafeInteger(candidatePostedMs)
      ? candidatePostedMs
      : 0;
  const title =
    typeof metadata.title === "string" && metadata.title.trim()
      ? metadata.title.trim()
      : `E-Hentai gallery ${reference.galleryId}`;

  return { title, postedMs, fileCount };
}

export class EHentaiMetadataClient {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async load(
    reference: EHentaiGalleryReference
  ): Promise<EHentaiGalleryMetadata> {
    let response: Response;
    try {
      response = await this.fetchImpl(API_URL, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "User-Agent": EHENTAI_USER_AGENT
        },
        body: JSON.stringify({
          method: "gdata",
          gidlist: [[Number(reference.galleryId), reference.galleryToken]],
          namespace: 1
        }),
        redirect: "error",
        signal: AbortSignal.timeout(EHENTAI_CONTROL_REQUEST_TIMEOUT_MS)
      });
    } catch {
      throw new ProviderError("unavailable", "Could not reach E-Hentai.");
    }

    if (response.status === 429 || response.status === 503) {
      throw new ProviderError(
        "rate-limited",
        "E-Hentai asked the app to slow down."
      );
    }
    if (!response.ok) {
      throw new ProviderError(
        "unavailable",
        `The gallery API returned ${response.status}.`
      );
    }

    try {
      return parseMetadata(await response.json(), reference);
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError(
        "invalid-response",
        "The gallery API returned invalid JSON."
      );
    }
  }
}
