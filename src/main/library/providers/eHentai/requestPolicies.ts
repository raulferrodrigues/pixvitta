import type { RequestPolicy } from "../../../requestBroker";

export const API_POLICY = {
  id: "e-hentai:api",
  delayMs: 5_000
} satisfies RequestPolicy;

export const PAGES_POLICY = {
  id: "e-hentai:pages",
  delayMs: 1_000
} satisfies RequestPolicy;

export const IMAGES_POLICY = {
  id: "e-hentai:images",
  delayMs: 2_000
} satisfies RequestPolicy;

export const THUMBNAILS_POLICY = {
  id: "e-hentai:thumbnails",
  delayMs: 200
} satisfies RequestPolicy;
