import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  getDesktopSources: () => ipcRenderer.invoke("get-desktop-sources"),
  getActiveWindows: () => ipcRenderer.invoke("get-active-windows"),
});
