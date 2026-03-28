import { app, BrowserWindow, ipcMain, desktopCapturer } from "electron";
import path from "path";
import { exec } from "child_process";
import activeWin from "active-win";

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    alwaysOnTop: true,
    frame: false,
    transparent: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
    titleBarStyle: "hiddenInset",
    backgroundColor: "#0a0a0f",
  });

  // In development, load the Vite dev server
  // In production, load the built HTML
  const isDev = process.env.NODE_ENV === "development" || !app.isPackaged;

  if (isDev) {
    mainWindow.loadURL("http://localhost:5173");
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// Handle request for desktop audio sources from renderer
ipcMain.handle("get-desktop-sources", async () => {
  const sources = await desktopCapturer.getSources({
    types: ["screen", "window"],
  });
  // Return serializable data (DesktopCapturerSource has non-serializable fields)
  return sources.map((s) => ({
    id: s.id,
    name: s.name,
  }));
});

// Get the active window, skipping our own Electron app
ipcMain.handle("get-active-windows", async () => {
  const windows = await activeWin.getOpenWindows();
  const own = app.getPath("exe");
  const external = windows.find(
    (w) => w.owner.path?.toLowerCase() !== own.toLowerCase()
  );
  if (!external) return [];
  return [
    {
      pid: external.owner.processId,
      name: external.owner.name,
      title: external.title,
    },
  ];
});

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
