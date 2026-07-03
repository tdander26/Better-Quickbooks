// Feed-provider registry. To add Teller later: implement FeedProvider in
// ./teller.ts and register it here — the rest of the app is provider-agnostic.

import type { FeedProvider } from "./types";
import { simplefinProvider } from "./simplefin";

const providers: Record<string, FeedProvider> = {
  [simplefinProvider.id]: simplefinProvider,
  // teller: tellerProvider,  // future
};

export function getProvider(id: string): FeedProvider {
  const p = providers[id];
  if (!p) throw new Error(`Unknown feed provider: ${id}`);
  return p;
}

export * from "./types";
