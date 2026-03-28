import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  getDesktopSources: () => ipcRenderer.invoke("get-desktop-sources"),
  getActiveWindows: () => ipcRenderer.invoke("get-active-windows"),
  onActiveWindowChanged: (callback: (windows: any[]) => void) => {
    ipcRenderer.on("active-window-changed", (_event, windows) => callback(windows));
  },
});
