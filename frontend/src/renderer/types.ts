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

export interface SessionData {
  session_id: string;
  room_id: string;
  peer_token: string;
  ws_url: string;
}

export interface LiveAnalysis {
  text: string;
  timestamp: number;
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

export interface SystemAudioCaptureSupport {
  platform: string;
  supported: boolean;
  isPackaged: boolean;
  screenAccessStatus:
    | "not-determined"
    | "granted"
    | "denied"
    | "restricted"
    | "unknown";
}

declare global {
  interface Window {
    electronAPI: {
      createSession: () => Promise<SessionData>;
      getSystemAudioCaptureSupport: () => Promise<SystemAudioCaptureSupport>;
      setOpacity: (value: number) => Promise<void>;
      onContextUpdate: (callback: (context: FullContext) => void) => () => void;
      onArticleAnalysis: (
        callback: (analysis: ArticleAnalysis) => void,
      ) => () => void;
    };
  }
}
