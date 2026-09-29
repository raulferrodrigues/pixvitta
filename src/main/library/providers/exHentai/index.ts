import { EHentaiProvider } from "../eHentai";
import { exHentaiSite } from "../eHentai/gallerySite";
import { getExHentaiSession, prepareExHentaiSession } from "./auth";

export class ExHentaiProvider extends EHentaiProvider {
  constructor() {
    // The shared gallery engine also shares broker policy IDs with E-Hentai.
    super({
      ...exHentaiSite,
      prepare: prepareExHentaiSession,
      fetch: (request) => getExHentaiSession().fetch(request)
    });
  }
}
