import type { GalleryAccess } from "./galleryAccess";

export type GallerySite = {
  id: "e-hentai" | "exhentai";
  name: string;
  origin: string;
  apiUrl: string;
  /** Static host that serves images and thumbnails besides H@H and ehgt.org. */
  assetOrigin?: string;
  authenticated: boolean;
  prepare?: () => Promise<GalleryAccess>;
};

export const eHentaiSite: GallerySite = {
  id: "e-hentai",
  name: "E-Hentai",
  origin: "https://e-hentai.org",
  apiUrl: "https://api.e-hentai.org/api.php",
  authenticated: false
};

export const exHentaiSite: GallerySite = {
  id: "exhentai",
  name: "ExHentai",
  origin: "https://exhentai.org",
  apiUrl: "https://s.exhentai.org/api.php",
  assetOrigin: "https://s.exhentai.org",
  authenticated: true
};

export function galleryRequest(
  site: GallerySite,
  url: string,
  init: RequestInit
): globalThis.Request {
  return new globalThis.Request(url, {
    ...init,
    credentials: site.authenticated ? "include" : "same-origin",
    redirect: site.authenticated ? "manual" : init.redirect
  });
}

export function isAuthenticationResponse(response: Response): boolean {
  return response.status === 401 || response.status === 403 ||
    (response.status >= 300 && response.status < 400);
}
