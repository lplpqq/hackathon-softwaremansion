import {
  app,
  BrowserWindow,
  ipcMain,
  desktopCapturer,
  Tray,
  session,
  systemPreferences,
} from "electron";
import path from "path";
import { ContextPoller } from "./services/context-poller";
import { createTray } from "./tray";
import { FullContext } from "./types";

if (process.platform === "darwin" && !app.isPackaged) {
  // In dev on macOS, the parent app (Terminal/IDE) usually lacks
  // NSAudioCaptureUsageDescription, which can yield a dead audio stream.
  app.commandLine.appendSwitch(
    "disable-features",
    "MacCatapLoopbackAudioForScreenShare",
  );
}

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
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    win.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  win.on("closed", () => {
    mainWindow = null;
  });

  return win;
}

const BACKEND_BASE = "https://4403-185-28-19-74.ngrok-free.app";

function setupMediaCapture() {
  session.defaultSession.setPermissionCheckHandler(
    (_webContents, permission) => permission === "media",
  );

  session.defaultSession.setPermissionRequestHandler(
    (_webContents, permission, callback) => {
      if (permission === "display-capture" || permission === "media") {
        callback(true);
        return;
      }

      callback(false);
    },
  );

  session.defaultSession.setDisplayMediaRequestHandler(
    async (request, callback) => {
      try {
        const [screenSource] = await desktopCapturer.getSources({
          types: ["screen"],
        });

        if (!screenSource) {
          callback({});
          return;
        }

        callback({
          video: screenSource,
          audio:
            process.platform === "win32" && request.audioRequested
              ? "loopback"
              : undefined,
        });
      } catch (error) {
        console.error("[display-media-request]", error);
        callback({});
      }
    },
    { useSystemPicker: process.platform === "darwin" },
  );
}

function setupIPC() {
  // Create Fishjam session — runs in main process to avoid renderer CORS
  ipcMain.handle("create-session", async () => {
    const res = await fetch(`${BACKEND_BASE}/create-session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    if (!res.ok) {
      throw new Error(`create-session failed: ${res.status}`);
    }
    return res.json();
  });

  ipcMain.handle("get-system-audio-capture-support", () => {
    return {
      platform: process.platform,
      supported: process.platform === "darwin",
      isPackaged: app.isPackaged,
      screenAccessStatus:
        process.platform === "darwin"
          ? systemPreferences.getMediaAccessStatus("screen")
          : "unknown",
    };
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
  setupMediaCapture();
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
