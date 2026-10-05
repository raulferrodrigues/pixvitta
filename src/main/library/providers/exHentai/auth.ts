import { app, BrowserWindow, session } from "electron";
import { ProviderError } from "../provider";
import { GalleryAuthentication, type GalleryAccess } from "../eHentai/galleryAccess";

const partition = "persist:exhentai";
const forumUrl = "https://forums.e-hentai.org/";
const exHentaiUrl = "https://exhentai.org/";
const accountCookieNames = ["ipb_member_id", "ipb_pass_hash"] as const;

let signInWindow: BrowserWindow | null = null;
const authentication = new GalleryAuthentication();

export function getExHentaiSession(): Electron.Session {
  return session.fromPartition(partition);
}

function validLoginNavigation(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return url.protocol === "https:" && (
      url.hostname === "forums.e-hentai.org" ||
      url.hostname === "e-hentai.org" ||
      url.hostname === "exhentai.org"
    );
  } catch {
    return false;
  }
}

export async function prepareExHentaiSession(): Promise<GalleryAccess> {
  await app.whenReady();
  if (signInWindow && !signInWindow.isDestroyed()) {
    throw new ProviderError("authentication-required", "Finish signing in first.");
  }
  const browserSession = getExHentaiSession();
  const fetch = (request: Request) => browserSession.fetch(request);
  const preparation = authentication.capture("", fetch);
  const cookies = browserSession.cookies;
  const forumCookies = await cookies.get({ url: forumUrl });
  preparation.assertCurrent();
  const exCookies = await cookies.get({ url: exHentaiUrl });
  preparation.assertCurrent();
  const accountCookies = accountCookieNames.map((name) => {
    const source = forumCookies.find((cookie) => cookie.name === name && cookie.value);
    if (!source || source.value === "0" || source.value === "deleted") {
      authentication.invalidate();
      throw new ProviderError("authentication-required", "Sign in to the E-Hentai forums first.");
    }
    return source;
  });
  if (accountCookies.some((source) =>
    exCookies.find((cookie) => cookie.name === source.name)?.value !== source.value
  )) {
    authentication.invalidate();
  }
  const accountId = accountCookies[0].value;
  const access = authentication.capture(accountId, fetch);
  const forumAccount = forumCookies.find((cookie) => cookie.name === "ipb_member_id" && cookie.value);
  const exAccount = exCookies.find((cookie) => cookie.name === "ipb_member_id" && cookie.value);
  // The forum and gallery use different registrable domains. Copy only the
  // account cookies into ExHentai's dedicated session; the site sets igneous.
  if (forumAccount && exAccount && forumAccount.value !== exAccount.value) {
    await cookies.remove(exHentaiUrl, "igneous");
    access.assertCurrent();
  }

  for (const source of accountCookies) {
    const existing = exCookies.find((cookie) => cookie.name === source.name && cookie.value);
    if (existing?.value === source.value) continue;
    await cookies.set({
      url: exHentaiUrl,
      domain: ".exhentai.org",
      path: "/",
      name: source.name,
      value: source.value,
      secure: true,
      httpOnly: true,
      ...(source.expirationDate ? { expirationDate: source.expirationDate } : {})
    });
    access.assertCurrent();
  }
  await cookies.flushStore();
  access.assertCurrent();
  return access;
}

export async function openExHentaiSignIn(parent: BrowserWindow | null): Promise<boolean> {
  await app.whenReady();
  if (signInWindow && !signInWindow.isDestroyed()) {
    signInWindow.focus();
    return false;
  }

  authentication.invalidate();
  const window = new BrowserWindow({
    width: 960,
    height: 760,
    minWidth: 640,
    minHeight: 500,
    title: "Sign in to E-Hentai Forums",
    ...(parent && !parent.isDestroyed() ? { parent } : {}),
    webPreferences: {
      // Remote forum content never receives Pixvitta's preload or Node APIs.
      session: getExHentaiSession(),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  signInWindow = window;
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (validLoginNavigation(url)) void window.loadURL(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (!validLoginNavigation(url)) event.preventDefault();
  });
  window.webContents.session.setPermissionRequestHandler((contents, permission, callback) => {
    void contents;
    void permission;
    callback(false);
  });

  const closed = new Promise<void>((resolve) => window.once("closed", resolve));
  try {
    await window.loadURL(forumUrl);
    await closed;
  } catch {
    if (!window.isDestroyed()) window.destroy();
    await closed;
    return false;
  } finally {
    if (signInWindow === window) signInWindow = null;
  }
  try {
    await prepareExHentaiSession();
    return true;
  } catch {
    return false;
  }
}
