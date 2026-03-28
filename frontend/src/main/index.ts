import { app, BrowserWindow, ipcMain, desktopCapturer, Tray } from "electron";
import path from "path";
import { ContextPoller } from "./services/context-poller";
import { createTray } from "./tray";
import { FullContext } from "./types";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let poller: ContextPoller | null = null;

function createOverlayWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 340,
    height: 240,
    minWidth: 280,
    minHeight: 180,
    alwaysOnTop: true,
    frame: false,
    transparent: true,
    skipTaskbar: true,
    hasShadow: false,
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Float above fullscreen apps where possible
  win.setAlwaysOnTop(true, "floating");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  const isDev = process.env.NODE_ENV === "development" || !app.isPackaged;

  if (isDev) {
    win.loadURL("http://localhost:5173");
  } else {
    win.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  win.on("closed", () => {
    mainWindow = null;
  });

  return win;
}

function setupIPC() {
  // Existing: desktop sources for audio capture
  ipcMain.handle("get-desktop-sources", async () => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ["screen", "window"],
      });
      return sources.map((s) => ({ id: s.id, name: s.name }));
    } catch (err) {
      console.error("[get-desktop-sources]", err);
      return [];
    }
  });

  // Overlay opacity control
  ipcMain.handle("set-opacity", (_event, value: number) => {
    if (mainWindow) {
      mainWindow.setOpacity(Math.max(0.2, Math.min(1.0, value)));
    }
  });
}

function startPoller() {
  poller = new ContextPoller({
    pollIntervalMs: 750,
    onContextChange: (ctx: FullContext) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("context-update", ctx);
      }
    },
    onArticleAnalysis: (analysis) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("article-analysis", analysis);
      }
    },
  });
  poller.start();
}

app.whenReady().then(() => {
  // Hide dock icon — this is a menu-bar app
  if (app.dock) {
    app.dock.hide();
  }

  mainWindow = createOverlayWindow();
  setupIPC();
  startPoller();

  tray = createTray({
    onToggleOverlay: () => {
      if (!mainWindow) {
        mainWindow = createOverlayWindow();
      } else if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.showInactive();
      }
    },
    onPauseDetection: () => poller?.stop(),
    onResumeDetection: () => poller?.start(),
    isOverlayVisible: () => mainWindow?.isVisible() ?? false,
    isDetectionRunning: () => poller?.isRunning ?? false,
  });
});

app.on("window-all-closed", () => {
  // Don't quit on macOS when overlay is closed — tray keeps app alive
});

app.on("activate", () => {
  if (!mainWindow) {
    mainWindow = createOverlayWindow();
  }
});
