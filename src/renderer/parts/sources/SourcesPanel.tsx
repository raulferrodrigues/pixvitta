import { Plus, X } from "lucide-react";
import { useGT } from "gt-react";
import type { MediaSourceMember } from "../../../shared/media";
import type { RecentSource } from "../../../shared/recentSources";
import { useViewerStore } from "../../state/ViewerStoreProvider";
import { AddSourceField } from "./AddSourceField";
import { SourceRowContent } from "./SourceRow";
import "./sources.css";

// The sources the open collection is made of, in the order their items
// interleave, with ways to add another: a location, a folder, or a recent
// source. It sits beside the media, so a change shows in the stream at once.
export function SourcesPanel() {
  const gt = useGT();
  const members = useViewerStore((state) => state.source?.members ?? []);
  const recentSources = useViewerStore((state) => state.recentSources);
  const toggleSourcesPanel = useViewerStore((state) => state.toggleSourcesPanel);
  // Main names the recent source each member is remembered as, so a recent
  // that is already in the collection is left out rather than listed twice.
  const memberLocations = new Set(members.map((member) => member.recentLocation));
  const recentsToAdd = recentSources.filter((source) => !memberLocations.has(source.location));

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
          <h3 id="sources-panel-members" className="sources-panel-heading">{gt("In the mix")}</h3>
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
              {recentsToAdd.map((source) => <RecentRow key={source.location} source={source} />)}
            </ul>
          </section>
        ) : null}
      </div>
    </aside>
  );
}

function MemberRow({ member, number, canRemove }: { member: MediaSourceMember; number: number | null; canRemove: boolean }) {
  const gt = useGT();
  const isSourceLoading = useViewerStore((state) => state.isSourceLoading);
  const removeSource = useViewerStore((state) => state.removeSource);
  return (
    <li className="source-row source-row-member" title={member.title} data-testid="source-member">
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
// main names it.
function MemberDetail({ member }: { member: MediaSourceMember }) {
  const gt = useGT();
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
          // The button is about to go, so hand focus on first: to the same
          // button on the next recent, else the previous one, else the field.
          const row = event.currentTarget.closest("li");
          const neighbour = row?.nextElementSibling ?? row?.previousElementSibling;
          const next =
            neighbour?.querySelector<HTMLElement>("[data-testid='remove-recent-source']") ??
            document.getElementById("add-source-location");
          next?.focus();
          void removeRecentSource(source.location);
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
