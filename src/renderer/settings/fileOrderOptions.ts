import type { FileOrder } from "../../shared/settings";

export const FILE_ORDER_OPTIONS: ReadonlyArray<{ value: FileOrder; label: string }> = [
  { value: "name", label: "Name" },
  { value: "kind", label: "Kind" },
  { value: "last-opened", label: "Date Last Opened" },
  { value: "date-added", label: "Date Added" },
  { value: "modified", label: "Date Modified" },
  { value: "created", label: "Date Created" },
  { value: "size", label: "Size" },
  { value: "random", label: "Random" }
];
