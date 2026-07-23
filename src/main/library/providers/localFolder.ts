import { randomBytes } from "node:crypto";
import { stat } from "node:fs/promises";
import path from "node:path";
import { createMediaFileResponse } from "../../media/mediaResponses";
import { scanFolder } from "../../media/mediaScanner";
import { isSupportedMediaPath } from "../../utils/mediaTypes";
import {
  ProviderError,
  type MediaProvider,
  type ProviderCollection,
  type ProviderLoadRequest
} from "./provider";

export class LocalFolderProvider implements MediaProvider {
  private randomOrderSession: { folderPath: string; seed: string } | null = null;

  matches(location: string): boolean {
    return path.isAbsolute(location);
  }

  async load(request: ProviderLoadRequest): Promise<ProviderCollection> {
    const requestedPath = path.resolve(request.location);
    let details;
    try {
      details = await stat(requestedPath);
    } catch {
      throw new ProviderError("not-found", "The local path could not be found.");
    }

    const selectedFile = details.isFile()
      ? requestedPath
      : undefined;
    if (selectedFile && !isSupportedMediaPath(selectedFile)) {
      throw new ProviderError("unsupported-location", "The selected file type is not supported.");
    }

    const folderPath = details.isDirectory()
      ? requestedPath
      : details.isFile()
        ? path.dirname(requestedPath)
        : null;
    if (!folderPath) {
      throw new ProviderError("unsupported-location", "The local path is not a directory or media file.");
    }

    const randomSeed = this.randomSeedFor(
      folderPath,
      request.settings.fileOrder,
      request.refresh
    );
    const result = await scanFolder(folderPath, {
      fileOrder: request.settings.fileOrder,
      includeHidden:
        request.settings.includeHidden ||
        (!!selectedFile && path.basename(selectedFile).startsWith(".")),
      randomSeed
    });
    const selectedItem = selectedFile
      ? result.items.find((item) => item.absolutePath === selectedFile)
      : undefined;

    if (selectedFile && !selectedItem) {
      throw new ProviderError("unsupported-location", "The selected file is not supported.");
    }

    return {
      canonicalLocation: result.folderPath,
      title: path.basename(result.folderPath) || result.folderPath,
      capabilities: {
        canDownload: false,
        canRefresh: true,
        canSort: true
      },
      remember: true,
      items: result.items.map((item) => ({
        key: item.id,
        name: item.name,
        kind: item.kind,
        sizeBytes: item.sizeBytes,
        lastOpenedMs: item.lastOpenedMs,
        addedMs: item.addedMs,
        modifiedMs: item.modifiedMs,
        createdMs: item.createdMs,
        media: {
          respond: (mediaRequest) =>
            createMediaFileResponse(item.absolutePath, mediaRequest.headers)
        },
        thumbnail: {
          kind: "direct",
          url: item.thumbnailUrl
        },
        localPath: item.absolutePath
      })),
      selectedKey: selectedItem?.id ?? result.items[0]?.id ?? null
    };
  }

  private randomSeedFor(
    folderPath: string,
    fileOrder: ProviderLoadRequest["settings"]["fileOrder"],
    refresh: boolean
  ): string | undefined {
    if (fileOrder !== "random") {
      this.randomOrderSession = null;
      return undefined;
    }

    if (refresh && this.randomOrderSession?.folderPath === folderPath) {
      return this.randomOrderSession.seed;
    }

    const seed = randomBytes(16).toString("hex");
    this.randomOrderSession = { folderPath, seed };
    return seed;
  }
}
