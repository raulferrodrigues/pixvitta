import type { PixvittaApi } from "../shared/pixvittaApi";

declare global {
  interface Window {
    pixvitta: PixvittaApi;
  }
}

export {};
