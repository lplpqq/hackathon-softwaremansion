export interface AppContext {
  appName: string;
  bundleId: string;
  windowTitle: string;
  timestamp: number;
}

export interface BrowserTabInfo {
  url: string;
  title: string;
  browserName: string;
}

export interface DomainClassification {
  domain: string;
  isNewsDomain: boolean;
  isVideoDomain: boolean;
  isSupportedDomain: boolean;
}

export type DetectionMode = "idle" | "news" | "video";

export interface FullContext {
  app: AppContext;
  tab: BrowserTabInfo | null;
  classification: DomainClassification | null;
  mode: DetectionMode;
}

export interface DesktopSource {
  id: string;
  name: string;
}

declare global {
  interface Window {
    electronAPI: {
      getDesktopSources: () => Promise<DesktopSource[]>;
      setOpacity: (value: number) => Promise<void>;
      onContextUpdate: (callback: (context: FullContext) => void) => () => void;
    };
  }
}
