import { ProviderError } from "../provider";
import type { GalleryAccess } from "./galleryAccess";

export type GallerySite = {
  id: "e-hentai" | "exhentai";
  name: string;
  origin: string;
  apiUrl: string;
  /** Static host that serves images and thumbnails besides H@H and ehgt.org. */
  assetOrigin?: string;
  /** The account the site signs in with. Sites without one are anonymous. */
  accountId?: string;
  prepare?: () => Promise<GalleryAccess>;
};

export const eHentaiSite: GallerySite = {
  id: "e-hentai",
  name: "E-Hentai",
  origin: "https://e-hentai.org",
  apiUrl: "https://api.e-hentai.org/api.php"
};

// The account ExHentai's provider declares; its errors name it.
export const exHentaiAccountId = "exhentai";

export const exHentaiSite: GallerySite = {
  id: "exhentai",
  name: "ExHentai",
  origin: "https://exhentai.org",
  apiUrl: "https://s.exhentai.org/api.php",
  assetOrigin: "https://s.exhentai.org",
  accountId: exHentaiAccountId
};

export function galleryRequest(
  site: GallerySite,
  url: string,
  init: RequestInit
): globalThis.Request {
  return new globalThis.Request(url, {
    ...init,
    credentials: site.accountId ? "include" : "same-origin",
    redirect: site.accountId ? "manual" : init.redirect
  });
}

export function isAuthenticationResponse(response: Response): boolean {
  return response.status === 401 || response.status === 403 ||
    (response.status >= 300 && response.status < 400);
}

export function authenticationRequired(site: GallerySite, message: string): ProviderError {
  return new ProviderError("authentication-required", message, site.accountId);
}
