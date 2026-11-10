import type { ProviderCollection, ProviderMediaItem } from "./providers";

// Item keys are namespaced by the member's canonical location even when there
// is only one member, so an item keeps its key, and therefore its public media
// ID, when another source is added to the collection.
export function mergedItemKey(canonicalLocation: string, key: string): string {
  return `${canonicalLocation}\0${key}`;
}

function mergedTitle(titles: readonly string[]): string {
  if (titles.length <= 1) return titles[0] ?? "";
  if (titles.length === 2) return `${titles[0]} + ${titles[1]}`;
  return `${titles[0]} + ${titles.length - 1} more`;
}

/**
 * Turns the member sources of the active collection into one collection. Items
 * are interleaved one per member in turn, in the order members were added
 * (A1, B1, A2, B2, ...); a member that runs out drops out of the rotation.
 * A single member comes out as the provider gave it, apart from its keys.
 */
export function mergeSources(
  members: readonly ProviderCollection[]
): ProviderCollection {
  const first = members[0];
  if (!first) throw new Error("A collection needs at least one source.");
  const isMerge = members.length > 1;

  const owners = new Map<string, { member: ProviderCollection; key: string }>();
  const items: ProviderMediaItem[] = [];
  const longest = Math.max(...members.map((member) => member.items.length));
  for (let position = 0; position < longest; position++) {
    for (const member of members) {
      const item = member.items[position];
      if (!item) continue;
      const key = mergedItemKey(member.canonicalLocation, item.key);
      owners.set(key, { member, key: item.key });
      items.push(
        isMerge
          ? { ...item, key, sourceLabel: member.title }
          : { ...item, key }
      );
    }
  }

  const hasViewing = members.some((member) => member.viewing);
  return {
    viewing: hasViewing
      ? {
          // Only the owner moves. The other members keep their last selection,
          // and with it their prefetch window, because in a zipper the next
          // step lands in another member: its next item is already on the way.
          // Clearing the selection still clears it everywhere.
          select(key) {
            if (key === null) {
              for (const member of members) member.viewing?.select(null);
              return;
            }
            const owner = owners.get(key);
            owner?.member.viewing?.select(owner.key);
          },
          deactivate() {
            for (const member of members) member.viewing?.deactivate();
          }
        }
      : undefined,
    canonicalLocation: first.canonicalLocation,
    title: mergedTitle(members.map((member) => member.title)),
    origin: isMerge ? undefined : first.origin,
    capabilities: isMerge
      ? {
          canRefresh: members.some((member) => member.capabilities.canRefresh),
          canSort: members.some((member) => member.capabilities.canSort),
          canDownload: members.every(
            (member) => member.capabilities.canDownload
          ),
          canDownloadCollection: members.every(
            (member) => member.capabilities.canDownloadCollection
          )
        }
      : first.capabilities,
    remember: isMerge ? false : first.remember,
    items,
    selectedKey:
      first.selectedKey === null
        ? null
        : mergedItemKey(first.canonicalLocation, first.selectedKey)
  };
}
