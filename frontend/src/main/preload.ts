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
  onArticleAnalysis: (callback: (analysis: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, analysis: unknown) =>
      callback(analysis);
    ipcRenderer.on("article-analysis", handler);
    return () => {
      ipcRenderer.removeListener("article-analysis", handler);
    };
  },
  onAnalysisStart: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on("article-analysis-start", handler);
    return () => {
      ipcRenderer.removeListener("article-analysis-start", handler);
    };
  },
});
