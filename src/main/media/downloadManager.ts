import { randomUUID } from "node:crypto";
import path from "node:path";
import type {
  DownloadActivitySnapshot,
  DownloadActivityState
} from "../../shared/media";
import type { RegisteredMediaItem } from "../library/mediaRegistry";
import type { MediaResource } from "../library/providers";
import {
  safeDownloadDirectoryName,
  writeMediaDownload
} from "./mediaDownload";

const TERMINAL_STATE_VISIBLE_MS = 900;

function debugDownload(message: string): void {
  console.debug(`[download ${new Date().toISOString()}] ${message}`);
}

type DownloadJob = {
  id: string;
  key: string;
  mediaId: string;
  name: string;
  directory: string;
  thumbnailUrl: string | null;
  state: DownloadActivityState;
  item: RegisteredMediaItem;
  operation: Promise<void> | null;
};

type DownloadManagerDependencies = {
  downloadsDirectory(): string;
  publish(snapshot: DownloadActivitySnapshot): void;
};

export class DownloadManager {
  private revision = 0;
  private readonly jobs: DownloadJob[] = [];
  private readonly activeByKey: {
    [key: string]: DownloadJob | undefined;
  } = {};
  private collectionActive = false;

  constructor(private readonly dependencies: DownloadManagerDependencies) {}

  getSnapshot(): DownloadActivitySnapshot {
    const itemStates: DownloadActivitySnapshot["itemStates"] = {};
    for (const job of this.jobs) {
      itemStates[job.mediaId] = job.state;
    }
    return {
      revision: this.revision,
      rows: this.jobs.map((job) => ({
        id: job.id,
        mediaId: job.mediaId,
        name: job.name,
        thumbnailUrl: job.thumbnailUrl,
        state: job.state
      })),
      itemStates,
      collectionActive: this.collectionActive
    };
  }

  start(item: RegisteredMediaItem): boolean {
    if (item.localPath) return false;
    const key = `individual:${item.id}`;
    const existing = this.activeByKey[key];
    if (existing) {
      void this.run(existing);
      return true;
    }

    const job = this.createJob(
      key,
      this.dependencies.downloadsDirectory(),
      item
    );
    this.publish();
    void this.run(job);
    return true;
  }

  startCollection(
    collectionName: string,
    items: RegisteredMediaItem[]
  ): boolean {
    if (this.collectionActive) return false;
    const downloadableItems = items.filter((item) => !item.localPath);
    if (downloadableItems.length === 0) return false;

    const collectionId = randomUUID();
    const directory = path.join(
      this.dependencies.downloadsDirectory(),
      safeDownloadDirectoryName(collectionName)
    );
    const jobs = downloadableItems.map((item) =>
      this.createJob(
        `collection:${collectionId}:${item.id}`,
        directory,
        item
      )
    );
    this.collectionActive = true;
    this.publish();
    void this.runCollection(jobs);
    return true;
  }

  resolveRetainedUrl(rawUrl: string): MediaResource | null {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      return null;
    }
    if (
      url.protocol !== "pixvitta-media:" ||
      url.hostname !== "thumbnail"
    ) {
      return null;
    }

    const mediaId = url.pathname.replace(/^\/+/, "");
    if (
      !mediaId ||
      mediaId.includes("/") ||
      mediaId.includes("\\") ||
      mediaId.includes("..")
    ) {
      return null;
    }
    for (let index = this.jobs.length - 1; index >= 0; index -= 1) {
      const job = this.jobs[index];
      if (job?.mediaId === mediaId) return job.item.thumbnail ?? null;
    }
    return null;
  }

  private createJob(
    key: string,
    directory: string,
    item: RegisteredMediaItem
  ): DownloadJob {
    const job: DownloadJob = {
      id: randomUUID(),
      key,
      mediaId: item.id,
      name: item.name,
      directory,
      thumbnailUrl: item.thumbnail
        ? `pixvitta-media://thumbnail/${item.id}`
        : null,
      state: "queued",
      item,
      operation: null
    };
    this.jobs.push(job);
    this.activeByKey[key] = job;
    return job;
  }

  private async runCollection(jobs: DownloadJob[]): Promise<void> {
    try {
      for (const job of jobs) {
        await this.run(job);
      }
    } finally {
      this.collectionActive = false;
      this.publish();
    }
  }

  private run(job: DownloadJob): Promise<void> {
    if (job.operation) return job.operation;
    const operation = this.perform(job);
    job.operation = operation;
    return operation;
  }

  private async perform(job: DownloadJob): Promise<void> {
    this.setState(job, "active");
    const kind = job.key.startsWith("collection:")
      ? "collection"
      : "individual";
    debugDownload(`started kind=${kind} name=${JSON.stringify(job.name)}`);
    try {
      const response = await job.item.media.respond(
        new Request(`pixvitta-media://media/${job.mediaId}?intent=download`),
        "low"
      );
      const downloadPath = await writeMediaDownload(
        job.directory,
        job.name,
        response
      );
      debugDownload(
        `completed kind=${kind} file=${JSON.stringify(path.basename(downloadPath))} directory=${JSON.stringify(path.basename(path.dirname(downloadPath)))}`
      );
      this.setState(job, "complete");
    } catch (error) {
      console.error("Could not download media.", error);
      this.setState(job, "failed");
    } finally {
      if (this.activeByKey[job.key] === job) {
        delete this.activeByKey[job.key];
      }
      setTimeout(() => this.removeTerminalJob(job), TERMINAL_STATE_VISIBLE_MS);
    }
  }

  private setState(job: DownloadJob, state: DownloadActivityState): void {
    if (!this.jobs.includes(job)) return;
    job.state = state;
    this.publish();
  }

  private removeTerminalJob(job: DownloadJob): void {
    if (job.state !== "complete" && job.state !== "failed") return;
    const index = this.jobs.indexOf(job);
    if (index < 0) return;
    this.jobs.splice(index, 1);
    this.publish();
  }

  private publish(): void {
    this.revision += 1;
    this.dependencies.publish(this.getSnapshot());
  }
}
