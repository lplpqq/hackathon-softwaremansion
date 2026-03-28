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

export interface ManipulationChunk {
  quote: string;
  explanation: string;
}

export interface ArticleAnalysis {
  source_credibility_score: number;
  publisher_description: string;
  short_text_analysis: string;
  potential_manipulation_text_chunks: ManipulationChunk[];
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
      onArticleAnalysis: (
        callback: (analysis: ArticleAnalysis) => void,
      ) => () => void;
      onAnalysisStart: (callback: () => void) => () => void;
    };
  }
}
