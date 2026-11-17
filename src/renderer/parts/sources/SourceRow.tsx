import { FolderOpen, Globe2, Layers } from "lucide-react";
import type { ReactNode } from "react";
import type { RecentSourceKind } from "../../../shared/recentSources";

// What a row shows in either of the panel's lists, so both read as the same
// kind of thing: an icon for the source's kind, its title, and a line of
// detail. Sources in the collection also carry their place in the order;
// other rows pass null to keep that column, so icons and titles line up across
// lists. A saved mix in recents has an icon of its own. The title slot can
// be a field, for renaming a mix, and the marker follows the title, such as a
// mix's pin. The end slot holds the row's action.
export function SourceRowContent({
  kind,
  title,
  marker,
  detail,
  number,
  end
}: {
  kind: RecentSourceKind | "mix";
  title: ReactNode;
  marker?: ReactNode;
  detail: ReactNode;
  number: number | null;
  end?: ReactNode;
}) {
  const KindIcon = kind === "mix" ? Layers : kind === "folder" ? FolderOpen : Globe2;
  return (
    <>
      <span className="source-row-number" aria-hidden>{number}</span>
      <span className="source-row-icon" aria-hidden><KindIcon size={14} /></span>
      <span className="source-row-text">
        {marker ? (
          <span className="source-row-title-line">
            <span className="source-row-title">{title}</span>
            {marker}
          </span>
        ) : (
          <span className="source-row-title">{title}</span>
        )}
        <span className="source-row-detail">{detail}</span>
      </span>
      {end}
    </>
  );
}

