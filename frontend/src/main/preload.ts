import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  getDesktopSources: () => ipcRenderer.invoke("get-desktop-sources"),
  setOpacity: (value: number) => ipcRenderer.invoke("set-opacity", value),
  onContextUpdate: (callback: (context: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, context: unknown) =>
      callback(context);
    ipcRenderer.on("context-update", handler);
    return () => {
      ipcRenderer.removeListener("context-update", handler);
    };
  },
});
