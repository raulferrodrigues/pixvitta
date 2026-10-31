import type { MediaProvider } from "./provider";

export class ProviderRegistry {
  constructor(private readonly providers: readonly MediaProvider[]) {}

  find(location: string): MediaProvider | null {
    return this.providers.find((provider) => provider.matches(location)) ?? null;
  }
}
