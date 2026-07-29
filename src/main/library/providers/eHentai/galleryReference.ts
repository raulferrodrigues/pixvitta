const GALLERY_ORIGIN = "https://e-hentai.org";
const GALLERY_TOKEN_PATTERN = /^[a-f0-9]{10}$/i;
const GALLERY_ID_PATTERN = /^[1-9]\d*$/;

export type EHentaiGalleryReference = {
  galleryId: string;
  galleryToken: string;
  pageUrl: string;
};

export function parseEHentaiGalleryUrl(
  input: string
): EHentaiGalleryReference | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }

  if (
    url.origin !== GALLERY_ORIGIN ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    return null;
  }

  const [route, galleryId, galleryToken, ...extra] = url.pathname
    .split("/")
    .filter(Boolean);
  const numericGalleryId = Number(galleryId);
  if (
    route !== "g" ||
    !galleryId ||
    !GALLERY_ID_PATTERN.test(galleryId) ||
    !Number.isSafeInteger(numericGalleryId) ||
    !galleryToken ||
    !GALLERY_TOKEN_PATTERN.test(galleryToken) ||
    extra.length > 0
  ) {
    return null;
  }

  const normalizedToken = galleryToken.toLowerCase();
  return {
    galleryId,
    galleryToken: normalizedToken,
    pageUrl: `${GALLERY_ORIGIN}/g/${galleryId}/${normalizedToken}/`
  };
}

export function isEHentaiLocation(input: string): boolean {
  try {
    return new URL(input.trim()).hostname === "e-hentai.org";
  } catch {
    return false;
  }
}
