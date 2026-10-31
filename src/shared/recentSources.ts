export type RecentSourceKind = "folder" | "web";

export type RecentSourceInput = {
  location: string;
  title: string;
  providerId: string;
  kind: RecentSourceKind;
};

export type RecentSource = RecentSourceInput & {
  openedMs: number;
};
