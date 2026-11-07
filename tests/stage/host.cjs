const { app, BrowserWindow } = require("electron");

// A bare Electron window with no preload, so the stage page can define its own
// window.pixvitta. Gives stage tests the Chromium that ships with the app, with
// no browser download.
app.setPath("userData", process.env.PIXVITTA_TEST_USER_DATA_DIR);
app.whenReady().then(() => {
  const window = new BrowserWindow({ width: 1180, height: 760, backgroundColor: "#101214" });
  window.setMenuBarVisibility(false);
  void window.loadURL(process.env.PIXVITTA_STAGE_URL);
});
app.on("window-all-closed", () => app.quit());
