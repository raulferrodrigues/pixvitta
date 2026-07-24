import { FourChanProvider } from "./fourChan";
import { LocalFolderProvider } from "./localFolder";
import { ProviderRegistry } from "./providerRegistry";

export function createProviderRegistry(): ProviderRegistry {
  return new ProviderRegistry([
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
