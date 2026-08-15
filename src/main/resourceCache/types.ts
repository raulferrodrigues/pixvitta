export type CachedFile = Readonly<{
  filePath: string;
  contentType: string;
  byteLength: number;
}>;
