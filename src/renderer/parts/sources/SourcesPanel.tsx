import { AlertCircle, Pin, Plus, X } from "lucide-react";
import { useGT } from "gt-react";
import { useRef, type MouseEvent } from "react";
import type { MediaSourceMember } from "../../../shared/media";
import { isRecentMix, type RecentMix, type RecentSource } from "../../../shared/recentSources";
import { errorMessage } from "../../folder-picker/SourceOpenError";
import { useViewerStore } from "../../state/ViewerStoreProvider";
import { AddSourceField } from "./AddSourceField";
import { MixNameField, useRenaming, useSavedMixDetail, useSavedMixMenu } from "./savedMixRow";
import { SourceRowContent } from "./SourceRow";
import "./sources.css";

// The sources the open collection is made of, in the order their items
// interleave, with ways to add another: a location, a folder, or a recent
// source. It sits beside the media, so a change shows in the stream at once.
// Recents also list saved mixes, which open in place of the collection
// rather than add to it.
export function SourcesPanel() {
  const gt = useGT();
  const members = useViewerStore((state) => state.source?.members ?? []);
  const recentSources = useViewerStore((state) => state.recentSources);
  const currentMixId = useViewerStore((state) => state.source?.mixId);
  const toggleSourcesPanel = useViewerStore((state) => state.toggleSourcesPanel);
  // Main names the recent source each member is remembered as, and the saved
  // mix the collection is, so neither is listed again under Recent.
  const memberLocations = new Set(members.map((member) => member.recentLocation));
  const recentsToAdd = recentSources.filter((entry) =>
    isRecentMix(entry) ? entry.id !== currentMixId : !memberLocations.has(entry.location)
  );
  // The open mix as recents list it: absent while it is not saved, as when it
  // is down to one source.
  const currentMix = recentSources.find(
    (entry): entry is RecentMix => isRecentMix(entry) && entry.id === currentMixId
  );

  return (
    <aside className="sources-panel" aria-labelledby="sources-panel-title" data-testid="sources-panel">
      <header className="sources-panel-header">
        <h2 id="sources-panel-title" className="sources-panel-title">
          {gt("Sources")}
          {members.length > 1 ? <span className="sources-panel-count">{members.length}</span> : null}
        </h2>
        <button
          type="button"
          className="sources-panel-close"
          title={gt("Hide sources")}
          aria-label={gt("Hide sources")}
          onClick={toggleSourcesPanel}
        >
          <X size={15} aria-hidden />
        </button>
      </header>
      <AddSourceField />
      <div className="sources-panel-scroll">
        <section className="sources-panel-section" aria-labelledby="sources-panel-members">
          <div className="sources-panel-heading-row">
            <h3 id="sources-panel-members" className="sources-panel-heading">{gt("In the mix")}</h3>
            {currentMix ? <CurrentMixLabel mix={currentMix} /> : null}
          </div>
          <ol className="sources-panel-list" data-testid="source-members">
            {members.map((member, index) => (
              // A lone source has no place in an order to show, and is closed by
              // opening another rather than removed from here.
              <MemberRow key={member.id} member={member} number={members.length > 1 ? index + 1 : null} canRemove={members.length > 1} />
            ))}
          </ol>
        </section>
        {recentsToAdd.length > 0 ? (
          <section className="sources-panel-section" aria-labelledby="sources-panel-recent">
            <h3 id="sources-panel-recent" className="sources-panel-heading">{gt("Recent")}</h3>
            <ul className="sources-panel-list" data-testid="recent-sources-to-add">
              {recentsToAdd.map((entry) =>
                isRecentMix(entry)
                  ? <RecentMixRow key={`mix:${entry.id}`} mix={entry} />
                  : <RecentRow key={entry.location} source={entry} />
              )}
            </ul>
          </section>
        ) : null}
      </div>
    </aside>
  );
}

// The open mix's pin, at the end of the "In the mix" heading, and once it is
// pinned its name, which renames in place on a click or F2. Pinning and
// renaming the open mix happen here because it is not listed under Recent.
function CurrentMixLabel({ mix }: { mix: RecentMix }) {
  const gt = useGT();
  const pinSavedMix = useViewerStore((state) => state.pinSavedMix);
  const startRenamingMix = useViewerStore((state) => state.startRenamingMix);
  const nameRef = useRef<HTMLButtonElement | null>(null);
  const isRenaming = useRenaming(mix, nameRef);
  return (
    <>
      {isRenaming ? (
        <MixNameField mix={mix} className="source-row-rename sources-panel-mix-rename" />
      ) : mix.pinned ? (
        <button
          ref={nameRef}
          type="button"
          className="sources-panel-mix-name"
          title={gt("Rename {title}", { title: mix.title })}
          aria-label={gt("Rename {title}", { title: mix.title })}
          data-testid="current-mix-name"
          onClick={() => startRenamingMix(mix.id)}
          onKeyDown={(event) => {
            if (event.key !== "F2") return;
            event.preventDefault();
            startRenamingMix(mix.id);
          }}
        >
          {mix.title}
        </button>
      ) : (
        <span className="sources-panel-heading-space" />
      )}
      <button
        type="button"
        className="source-row-action sources-panel-mix-pin"
        title={mix.pinned ? gt("Unpin") : gt("Pin")}
        aria-label={mix.pinned ? gt("Unpin {title}", { title: mix.title }) : gt("Pin {title}", { title: mix.title })}
        aria-pressed={mix.pinned}
        data-testid="pin-current-mix"
        onClick={() => void pinSavedMix(mix.id, !mix.pinned)}
      >
        <Pin size={12} aria-hidden fill={mix.pinned ? "currentColor" : "none"} />
      </button>
    </>
  );
}

function MemberRow({ member, number, canRemove }: { member: MediaSourceMember; number: number | null; canRemove: boolean }) {
  const gt = useGT();
  const isSourceLoading = useViewerStore((state) => state.isSourceLoading);
  const removeSource = useViewerStore((state) => state.removeSource);
  return (
    <li
      className="source-row source-row-member"
      title={member.title}
      data-testid="source-member"
      data-failed={member.error ? true : undefined}
    >
      <SourceRowContent
        kind={member.kind}
        title={member.title}
        detail={<MemberDetail member={member} />}
        number={number}
        end={canRemove ? (
          <button
            type="button"
            className="source-row-action"
            title={gt("Remove from the mix")}
            aria-label={gt("Remove {title}", { title: member.title })}
            data-testid="remove-source"
            disabled={isSourceLoading}
            onClick={() => void removeSource(member.id)}
          >
            <X size={14} aria-hidden />
          </button>
        ) : null}
      />
    </li>
  );
}

// How much a source brings, and for a web source the site it comes from, as
// main names it. A source whose last load failed shows why instead; it keeps
// what it had, and the next refresh tries it again.
// One that failed because it needs sign-in offers it; once signed in, the
// collection refreshes, which tries the source again.
function MemberDetail({ member }: { member: MediaSourceMember }) {
  const gt = useGT();
  const isSourceLoading = useViewerStore((state) => state.isSourceLoading);
  const signInAndRefresh = useViewerStore((state) => state.signInAndRefresh);
  if (member.error) {
    return (
      <span className="source-row-error" role="status" data-testid="source-member-error">
        <AlertCircle size={11} aria-hidden />
        <span>
          {errorMessage(member.error, gt)}
          {member.error === "authentication-required" ? (
            <>
              {" "}
              <button
                type="button"
                className="source-row-sign-in"
                aria-label={gt("Sign in for {title}", { title: member.title })}
                data-testid="member-sign-in"
                disabled={isSourceLoading}
                onClick={() => void signInAndRefresh()}
              >
                {gt("Sign in")}
              </button>
            </>
          ) : null}
        </span>
      </span>
    );
  }
  const count = gt("{count, plural, one {# item} other {# items}}", { count: member.itemCount });
  return member.siteName ? <>{count} · {member.siteName}</> : <>{count}</>;
}

// The whole row is one button: the "+" only marks what clicking it does.
// Removing the recent is a second, quieter button laid over the kind icon at
// the other end of the row, far from the "+", so neither is hit for the other.
function RecentRow({ source }: { source: RecentSource }) {
  const gt = useGT();
  const isSourceLoading = useViewerStore((state) => state.isSourceLoading);
  const addLocation = useViewerStore((state) => state.addLocation);
  const removeRecentSource = useViewerStore((state) => state.removeRecentSource);
  return (
    <li className="source-recent">
      <button
        type="button"
        className="source-row source-row-recent"
        title={gt("Add {location}", { location: source.location })}
        aria-label={gt("Add {title}", { title: source.title })}
        data-testid="add-recent-source"
        disabled={isSourceLoading}
        onClick={() => void addLocation(source.location)}
      >
        <SourceRowContent
          kind={source.kind}
          title={source.title}
          detail={<SourceLocation source={source} />}
          number={null}
          end={<span className="source-row-action source-row-add" aria-hidden><Plus size={14} /></span>}
        />
      </button>
      <button
        type="button"
        className="source-row-action source-row-forget"
        title={gt("Remove from recents")}
        aria-label={gt("Remove {title} from recents", { title: source.title })}
        data-testid="remove-recent-source"
        onClick={(event) => {
          handFocusOn(event);
          void removeRecentSource(source.location);
        }}
      >
        <X size={13} aria-hidden />
      </button>
    </li>
  );
}

// A forget button is about to go, so hand focus on first: to the same button
// on the next recent, else the previous one, else the field.
function handFocusOn(event: MouseEvent<HTMLElement>) {
  const row = event.currentTarget.closest("li");
  const neighbour = row?.nextElementSibling ?? row?.previousElementSibling;
  const next =
    neighbour?.querySelector<HTMLElement>(".source-row-forget") ??
    document.getElementById("add-source-location");
  next?.focus();
}

// A saved mix opens in place of the collection, through the replace question
// when what is open is a mix; its end says "Open" where a source's says "+".
// It is laid out like a source's row, with the same forget button over the
// icon. Pinning and renaming are in its menu (right-click, the menu key, or
// Shift+F10), and F2 renames a pinned mix.
function RecentMixRow({ mix }: { mix: RecentMix }) {
  const gt = useGT();
  const isSourceLoading = useViewerStore((state) => state.isSourceLoading);
  const openSavedMix = useViewerStore((state) => state.openSavedMix);
  const removeSavedMix = useViewerStore((state) => state.removeSavedMix);
  const menu = useSavedMixMenu(mix);
  const detail = useSavedMixDetail(mix);
  const rowRef = useRef<HTMLButtonElement | null>(null);
  const isRenaming = useRenaming(mix, rowRef);
  const pin = mix.pinned ? (
    <span className="source-row-pin" title={gt("Pinned")} data-testid="mix-pinned"><Pin size={10} aria-label={gt("Pinned")} /></span>
  ) : null;
  return (
    <li className="source-recent" data-testid="recent-mix">
      {isRenaming ? (
        <div className="source-row source-row-recent source-row-mix" data-renaming>
          <SourceRowContent
            kind="mix"
            title={<MixNameField mix={mix} className="source-row-rename" />}
            detail={detail}
            number={null}
          />
        </div>
      ) : (
        <button
          ref={rowRef}
          type="button"
          className="source-row source-row-recent source-row-mix"
          title={gt("Open {title} in place of what is open", { title: mix.title })}
          aria-label={gt("Open {title}", { title: mix.title })}
          data-testid="open-recent-mix"
          disabled={isSourceLoading}
          onClick={() => void openSavedMix(mix.id)}
          {...menu}
        >
          <SourceRowContent
            kind="mix"
            title={mix.title}
            marker={pin}
            detail={detail}
            number={null}
            end={<span className="source-row-action source-row-open" aria-hidden>{gt("Open")}</span>}
          />
        </button>
      )}
      <button
        type="button"
        className="source-row-action source-row-forget"
        title={gt("Remove from recents")}
        aria-label={gt("Remove {title} from recents", { title: mix.title })}
        data-testid="remove-recent-mix"
        onClick={(event) => {
          handFocusOn(event);
          void removeSavedMix(mix.id);
        }}
      >
        <X size={13} aria-hidden />
      </button>
    </li>
  );
}

// A folder path keeps its last folder in view and gives up the middle when it
// is long; a web address keeps its host and drops the scheme.
function SourceLocation({ source }: { source: RecentSource }) {
  if (source.kind === "folder") {
    const cut = source.location.replace(/[\\/]+$/, "").search(/[\\/][^\\/]+$/);
    if (cut > 0) {
      return (
        <span className="source-row-path">
          <span className="source-row-path-head">{source.location.slice(0, cut)}</span>
          <span className="source-row-path-tail">{source.location.slice(cut)}</span>
        </span>
      );
    }
  }
  return <>{source.kind === "web" ? webAddress(source.location) : source.location}</>;
}

function webAddress(location: string): string {
  try {
    const url = new URL(location);
    return `${url.host}${url.pathname}`.replace(/\/$/, "");
  } catch {
    return location;
  }
}
