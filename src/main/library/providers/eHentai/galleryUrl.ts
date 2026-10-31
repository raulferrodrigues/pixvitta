import { eHentaiSite, type GallerySite } from "./gallerySite";

export type EHentaiGalleryReference = {
  galleryId: string;
  galleryToken: string;
  pageUrl: string;
};

export function parseEHentaiGalleryUrl(
  input: string,
  site: GallerySite = eHentaiSite
): EHentaiGalleryReference | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }

  if (
    url.protocol !== "https:" ||
    url.origin !== site.origin ||
    url.port ||
    url.username ||
    url.password ||
    url.search
  ) {
    return null;
  }

  const [route, galleryId, galleryToken, ...extra] = url.pathname
    .split("/")
    .filter(Boolean);
  if (
    route !== "g" ||
    !galleryId ||
    !/^[1-9]\d*$/.test(galleryId) ||
    !galleryToken ||
    !/^[a-f0-9]{10}$/i.test(galleryToken) ||
    extra.length > 0
  ) {
    return null;
  }

  return {
    galleryId,
    galleryToken: galleryToken.toLowerCase(),
    pageUrl: `${site.origin}/g/${galleryId}/${galleryToken.toLowerCase()}/`
  };
}
