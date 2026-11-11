import { FolderOpen, Globe2, Layers, Pin, X } from "lucide-react";
import { useGT } from "gt-react";
import { useRef } from "react";
import type { RecentMix, RecentSource } from "../../shared/recentSources";
import { MixNameField, useRenaming, useSavedMixDetail, useSavedMixMenu } from "../parts/sources/savedMixRow";
import { useViewerStore } from "../state/ViewerStoreProvider";

type RecentSourceItemProps = { source: RecentSource; index: number };

const ROW_CLASS = "group grid min-h-[58px] grid-cols-[minmax(0,1fr)_auto] items-center rounded-xl border border-pix-recent-border bg-pix-recent text-pix-recent-text transition-colors hover:border-pix-tile-border-hover/60 hover:bg-pix-recent-hover";
const MAIN_CLASS = "grid h-full min-w-0 grid-cols-[34px_minmax(0,1fr)] items-center gap-3 rounded-l-xl px-3 py-2 text-left";
const MAIN_BUTTON_CLASS = `${MAIN_CLASS} cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-pix-accent`;
const ICON_CLASS = "flex size-[34px] items-center justify-center rounded-lg bg-white/5 text-pix-muted";
const TITLE_CLASS = "overflow-hidden text-ellipsis whitespace-nowrap text-sm font-semibold";
const DETAIL_CLASS = "overflow-hidden text-ellipsis whitespace-nowrap text-xs text-pix-recent-path";
const END_BUTTON_CLASS = "flex size-8 cursor-pointer items-center justify-center rounded-md transition-opacity hover:bg-white/10 hover:opacity-100 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-pix-accent";
// Like the remove button on a source's row: shown on hover or focus.
const HOVER_ONLY_CLASS = "text-pix-recent-path opacity-0 group-hover:opacity-70 hover:text-pix-recent-text";

export function RecentSourceItem({ source, index }: RecentSourceItemProps) {
  const gt = useGT();
  const openRecentSource = useViewerStore((state) => state.openRecentSource);
  const removeRecentSource = useViewerStore((state) => state.removeRecentSource);
  const SourceIcon = source.kind === "folder" ? FolderOpen : Globe2;

  return (
    <div className="group grid min-h-[58px] grid-cols-[minmax(0,1fr)_40px] items-center rounded-xl border border-pix-recent-border bg-pix-recent text-pix-recent-text transition-colors hover:border-pix-tile-border-hover/60 hover:bg-pix-recent-hover">
      <button
        className="grid h-full min-w-0 cursor-pointer grid-cols-[34px_minmax(0,1fr)] items-center gap-3 rounded-l-xl px-3 py-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-pix-accent"
        type="button"
        title={source.location}
        data-testid={`recent-source-item-${index}`}
        onClick={() => void openRecentSource(source.location)}
      >
        <span className="flex size-[34px] items-center justify-center rounded-lg bg-white/5 text-pix-muted" aria-hidden>
          <SourceIcon size={17} />
        </span>
        <span className="grid min-w-0 gap-[3px]">
          <span className="overflow-hidden text-ellipsis whitespace-nowrap text-sm font-semibold">{source.title}</span>
          <span className="overflow-hidden text-ellipsis whitespace-nowrap text-xs text-pix-recent-path">{source.location}</span>
        </span>
      </button>
      <button
        className="flex size-8 cursor-pointer items-center justify-center rounded-md text-pix-recent-path opacity-0 transition-opacity group-hover:opacity-70 hover:bg-white/10 hover:text-pix-recent-text hover:opacity-100 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-pix-accent"
        type="button"
        title={gt("Remove from recent sources")}
        aria-label={gt("Remove from recent sources")}
        onClick={() => void removeRecentSource(source.location)}
      >
        <X size={16} aria-hidden />
      </button>
    </div>
  );
}

// A saved mix opens in full. Its pin shows at the end of the row: always
// when pinned, on hover otherwise, beside the remove button. Renaming is in
// its menu, and F2.
export function RecentMixItem({ mix, index }: { mix: RecentMix; index: number }) {
  const gt = useGT();
  const openSavedMix = useViewerStore((state) => state.openSavedMix);
  const removeSavedMix = useViewerStore((state) => state.removeSavedMix);
  const pinSavedMix = useViewerStore((state) => state.pinSavedMix);
  const menu = useSavedMixMenu(mix);
  const detail = useSavedMixDetail(mix);
  const rowRef = useRef<HTMLButtonElement | null>(null);
  const isRenaming = useRenaming(mix, rowRef);
  const icon = (
    <span className={ICON_CLASS} aria-hidden>
      <Layers size={17} />
    </span>
  );

  return (
    <div className={ROW_CLASS} data-testid="recent-mix" data-pinned={mix.pinned || undefined}>
      {isRenaming ? (
        <div className={MAIN_CLASS}>
          {icon}
          <span className="grid min-w-0 gap-[3px]">
            <MixNameField mix={mix} className="min-w-0 rounded-md border border-pix-accent bg-black/25 px-1.5 py-px text-sm font-semibold text-pix-recent-text outline-none" />
            <span className={DETAIL_CLASS}>{detail}</span>
          </span>
        </div>
      ) : (
        <button
          ref={rowRef}
          className={MAIN_BUTTON_CLASS}
          type="button"
          title={gt("Open {title}", { title: mix.title })}
          data-testid={`recent-source-item-${index}`}
          onClick={() => void openSavedMix(mix.id)}
          {...menu}
        >
          {icon}
          <span className="grid min-w-0 gap-[3px]">
            <span className={TITLE_CLASS} data-testid="recent-mix-title">{mix.title}</span>
            <span className={DETAIL_CLASS}>{detail}</span>
          </span>
        </button>
      )}
      <div className="flex items-center pr-2">
        <button
          className={`${END_BUTTON_CLASS} ${mix.pinned ? "text-pix-accent" : HOVER_ONLY_CLASS}`}
          type="button"
          title={mix.pinned ? gt("Unpin") : gt("Pin")}
          aria-label={mix.pinned ? gt("Unpin {title}", { title: mix.title }) : gt("Pin {title}", { title: mix.title })}
          aria-pressed={mix.pinned}
          data-testid="pin-mix"
          onClick={() => void pinSavedMix(mix.id, !mix.pinned)}
        >
          <Pin size={15} aria-hidden fill={mix.pinned ? "currentColor" : "none"} />
        </button>
        <button
          className={`${END_BUTTON_CLASS} ${HOVER_ONLY_CLASS}`}
          type="button"
          title={gt("Remove from recent sources")}
          aria-label={gt("Remove {title} from recent sources", { title: mix.title })}
          data-testid="remove-recent-mix"
          onClick={() => void removeSavedMix(mix.id)}
        >
          <X size={16} aria-hidden />
        </button>
      </div>
    </div>
  );
}
