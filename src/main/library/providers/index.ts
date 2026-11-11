import { EHentaiProvider } from "./eHentai";
import { ExHentaiProvider } from "./exHentai";
import { FourChanProvider } from "./fourChan";
import { LocalFolderProvider } from "./localFolder";
import { NHentaiProvider } from "./nhentai";
import { ProviderRegistry } from "./providerRegistry";

export function createProviderRegistry(): ProviderRegistry {
  return new ProviderRegistry([
    new EHentaiProvider(),
    new ExHentaiProvider(),
    new FourChanProvider(),
    new NHentaiProvider(),
    new LocalFolderProvider()
  ]);
}

export type {
  MediaProvider,
  MediaResource,
  ProviderCollection,
  ProviderAccount,
  ProviderLoadRequest,
  ProviderMediaItem
} from "./provider";
export { ProviderError } from "./provider";
export { ProviderRegistry } from "./providerRegistry";
