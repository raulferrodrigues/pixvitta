import { useGT } from "gt-react";
import { useEffect, useRef, type KeyboardEvent, type MouseEvent, type RefObject } from "react";
import type { RecentMix } from "../../../shared/recentSources";
import { useViewerStore } from "../../state/ViewerStoreProvider";

/*
 * What a saved mix's row does wherever recents are listed: the first-run
 * screen and the sources panel. Pinning, renaming, and removing live in the
 * mix's native menu, opened by a right-click, or from the keyboard with the
 * menu key or Shift+F10. F2 renames a pinned mix in place.
 */

// Handlers for the element that opens the mix.
export function useSavedMixMenu(mix: RecentMix) {
  const showSavedMixMenu = useViewerStore((state) => state.showSavedMixMenu);
  const startRenamingMix = useViewerStore((state) => state.startRenamingMix);
  return {
    onContextMenu(event: MouseEvent<HTMLElement>) {
      event.preventDefault();
      // Main places the menu at the pointer.
      showSavedMixMenu(mix.id);
    },
    onKeyDown(event: KeyboardEvent<HTMLElement>) {
      if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) {
        event.preventDefault();
        const box = event.currentTarget.getBoundingClientRect();
        showSavedMixMenu(mix.id, { x: box.left + 8, y: box.bottom });
      } else if (event.key === "F2" && mix.pinned) {
        event.preventDefault();
        startRenamingMix(mix.id);
      }
    }
  };
}

// The mix's detail line: how many sources, then which.
export function useSavedMixDetail(mix: RecentMix): string {
  const gt = useGT();
  const count = gt("{count, plural, one {# source} other {# sources}}", { count: mix.members.length });
  return `${count} · ${mix.members.map((member) => member.title).join(", ")}`;
}

// Whether this mix is being renamed, and focus back on the row once it is
// not, if the field had it.
export function useRenaming(mix: RecentMix, rowRef: RefObject<HTMLElement | null>): boolean {
  const isRenaming = useViewerStore((state) => state.renamingMixId === mix.id);
  const wasRenaming = useRef(false);
  useEffect(() => {
    if (wasRenaming.current && !isRenaming && (document.activeElement === document.body || document.activeElement === null)) {
      rowRef.current?.focus();
    }
    wasRenaming.current = isRenaming;
  }, [isRenaming, rowRef]);
  return isRenaming;
}

// Edits a pinned mix's name in place of its title. Enter or leaving the field
// saves it, Escape keeps the old one, and an empty name goes back to the
// automatic title.
export function MixNameField({ mix, className }: { mix: RecentMix; className: string }) {
  const gt = useGT();
  const finishRenamingMix = useViewerStore((state) => state.finishRenamingMix);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const finished = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const finish = (name: string | null) => {
    if (finished.current) return;
    finished.current = true;
    void finishRenamingMix(name);
  };

  return (
    <input
      ref={inputRef}
      className={className}
      defaultValue={mix.name ?? mix.title}
      maxLength={120}
      aria-label={gt("Name of the mix")}
      data-testid="mix-name-field"
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          finish(event.currentTarget.value);
        } else if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          finish(null);
        }
      }}
      onBlur={(event) => finish(event.currentTarget.value)}
    />
  );
}
