import type { MediaProvider, ProviderAccount } from "./provider";

export class ProviderRegistry {
  constructor(private readonly providers: readonly MediaProvider[]) {}

  find(location: string): MediaProvider | null {
    return this.providers.find((provider) => provider.matches(location)) ?? null;
  }

  accounts(): ProviderAccount[] {
    const accounts = new Map<string, ProviderAccount>();
    for (const provider of this.providers) {
      if (provider.account) accounts.set(provider.account.id, provider.account);
    }
    return [...accounts.values()];
  }

  account(id: string): ProviderAccount | null {
    return this.accounts().find((account) => account.id === id) ?? null;
  }
}
