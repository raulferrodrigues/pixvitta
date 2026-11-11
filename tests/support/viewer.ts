import { expect, type Locator, type Page } from "@playwright/test";

/*
 * Everything the tests know about the viewer's markup lives here. A previous E2E
 * suite asserted on DOM details directly and broke on every renderer refactor
 * until it was deleted. When the UI changes, update this file; a spec should
 * only need to change when behavior does.
 */
export class Viewer {
  readonly page: Page;
  readonly filename: Locator;
  readonly image: Locator;
  readonly video: Locator;
  readonly filmstripTiles: Locator;
  readonly sourceError: Locator;
  readonly mediaError: Locator;
  readonly updateRow: Locator;
  readonly updateButton: Locator;
  /** The URL field of the open "Open from the web" dialog. */
  readonly webSourceField: Locator;

  constructor(page: Page) {
    this.page = page;
    this.filename = page.getByTestId("filename");
    this.image = page.getByTestId("image-media");
    this.video = page.getByTestId("video-media");
    this.filmstripTiles = page.locator('[data-testid^="filmstrip-item-"]');
    this.sourceError = page.getByRole("alert");
    this.mediaError = page.getByTestId("media-error");
    this.updateRow = page.getByTestId("update-row");
    this.updateButton = page.getByTestId("update-button");
    this.webSourceField = page.locator("dialog[open] #source-location");
  }

  /** Opens the "Open from the web" dialog from the top bar; it focuses its field. */
  async openWebSourceDialog(): Promise<void> {
    await this.page.getByTestId("open-web-source").click();
    await expect(this.webSourceField).toBeFocused();
  }

  async closeWebSourceDialog(): Promise<void> {
    await this.page.locator("dialog[open]").getByRole("button", { name: "Close" }).click();
    await expect(this.webSourceField).toHaveCount(0);
  }

  async pickFolder(): Promise<void> {
    await this.page.getByTestId("open-folder-empty").click();
  }

  /** Pastes a location into the source picker, which is showing when nothing is open. */
  async openLocation(location: string): Promise<void> {
    await this.page.locator("#source-location").fill(location);
    await this.page.locator("#source-location").press("Enter");
  }

  async openRecentSource(index: number): Promise<void> {
    await this.page.getByTestId(`recent-source-item-${index}`).click();
  }

  async clickTile(name: string): Promise<void> {
    await this.filmstripTiles.and(this.page.locator(`[title="${name}"]`)).click();
  }

  async expectShowing(name: string): Promise<void> {
    await expect(this.filename).toHaveText(name);
  }

  /**
   * Reads the store's answer, through the toggle bound to it. The native dialog
   * hides a task before its close event clears the store, so its visibility alone
   * would let a test act while the store still considers it open.
   */
  async expectSettingsOpen(isOpen: boolean): Promise<void> {
    await expect(this.page.getByTestId("settings-toggle")).toHaveAttribute("aria-pressed", String(isOpen));
    await expect(this.page.getByTestId("settings-modal")).toBeVisible({ visible: isOpen });
  }

  async openSettings(): Promise<void> {
    await this.page.getByTestId("settings-toggle").click();
    await this.expectSettingsOpen(true);
  }

  /** The gear flags an update that waits on the button in Settings. */
  async expectUpdatePending(isPending: boolean): Promise<void> {
    const toggle = this.page.getByTestId("settings-toggle");
    if (isPending) await expect(toggle).toHaveAttribute("data-update-pending", "true");
    else await expect(toggle).not.toHaveAttribute("data-update-pending");
  }

  /** The step the update button offers: check, download, install, or none while busy. */
  async expectUpdateStep(action: "check" | "download" | "install" | "none", status?: string): Promise<void> {
    await expect(this.updateButton).toHaveAttribute("data-action", action);
    await expect(this.updateButton).toBeEnabled({ enabled: action !== "none" });
    if (status) await expect(this.updateRow).toHaveAttribute("data-status", status);
  }

  async tileNames(): Promise<string[]> {
    return this.filmstripTiles.evaluateAll((tiles) => tiles.map((tile) => tile.getAttribute("title") ?? ""));
  }

  /**
   * Proves every tile shows a thumbnail from the cache. A cache miss sends a tile
   * through renderer capture, whose image URLs are marked, so it cannot pass here.
   */
  async expectThumbnailsServedFromCache(): Promise<void> {
    await expect
      .poll(() => this.filmstripTiles.locator("img").evaluateAll((images: HTMLImageElement[]) =>
        images.map((image) => image.complete && image.naturalWidth > 0 && !/captured=|intent=prefetch/.test(image.src))))
      .toEqual(new Array(await this.filmstripTiles.count()).fill(true));
  }

  /** Proves pixels arrived: a broken or unloaded image has no natural size. */
  async expectImageDecoded(size: { width: number; height: number }): Promise<void> {
    await expect
      .poll(() => this.image.evaluate((image: HTMLImageElement) => ({ width: image.naturalWidth, height: image.naturalHeight })))
      .toEqual(size);
  }

  /** Proves the video decodes a frame and can seek, which needs Range requests to work. */
  async expectVideoSeekable(): Promise<void> {
    await expect.poll(() => this.video.evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThanOrEqual(2);
    await this.video.evaluate((video: HTMLVideoElement) => { video.currentTime = 1.5; });
    await expect
      .poll(() => this.video.evaluate((video: HTMLVideoElement) => !video.seeking && video.readyState >= 2 && video.currentTime > 1))
      .toBe(true);
  }
}
