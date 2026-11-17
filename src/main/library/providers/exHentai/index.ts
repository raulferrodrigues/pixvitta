import { EHentaiProvider } from "../eHentai";
import { exHentaiSite } from "../eHentai/gallerySite";
import { exHentaiAccount, prepareExHentaiSession } from "./auth";

export class ExHentaiProvider extends EHentaiProvider {
  readonly account = exHentaiAccount;

  constructor() {
    // The shared gallery engine also shares broker policy IDs with E-Hentai.
    super({
      ...exHentaiSite,
      prepare: prepareExHentaiSession
    });
  }
}
