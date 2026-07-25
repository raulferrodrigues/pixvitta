import { EHentaiProvider } from "./eHentai";
import { FourChanProvider } from "./fourChan";
import { LocalFolderProvider } from "./localFolder";
import { ProviderRegistry } from "./providerRegistry";

type ProviderRegistryOptions = {
  cacheDirectory: () => string;
};

export function createProviderRegistry(
  options: ProviderRegistryOptions
): ProviderRegistry {
  return new ProviderRegistry([
    new EHentaiProvider({
      cacheDirectory: options.cacheDirectory
    }),
    new FourChanProvider(),
    new LocalFolderProvider()
  ]);
}

export type {
  MediaProvider,
  MediaResource,
  ProviderCollection,
  ProviderLoadRequest,
  ProviderMediaItem
} from "./provider";
export { ProviderError } from "./provider";
export { ProviderRegistry } from "./providerRegistry";
