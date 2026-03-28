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
