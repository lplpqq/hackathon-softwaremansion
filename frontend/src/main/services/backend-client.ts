import { FullContext } from "../types";

const BACKEND_URL = "http://localhost:8000/api/context";
const CHECK_ARTICLE_URL =
  "https://4403-185-28-19-74.ngrok-free.app/check-article";

export interface ArticleAnalysis {
  source_credibility_score: number;
  publisher_description: string;
  short_text_analysis: string;
  potential_manipulation_text_chunks: { quote: string; explanation: string }[];
}

export async function checkArticle(
  url: string,
): Promise<ArticleAnalysis | null> {
  try {
    const res = await fetch(CHECK_ARTICLE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    if (!res.ok) {
      console.warn("[check-article] Non-OK response:", res.status);
      return null;
    }
    return (await res.json()) as ArticleAnalysis;
  } catch (err) {
    console.warn("[check-article] Failed:", err);
    return null;
  }
}

export async function notifyBackend(context: FullContext): Promise<void> {
  if (!context.tab || !context.classification?.isSupportedDomain) return;

  const payload = {
    appName: context.app.appName,
    browserName: context.tab.browserName,
    url: context.tab.url,
    title: context.tab.title,
    domain: context.classification.domain,
    detectedAt: new Date(context.app.timestamp).toISOString(),
    mode: context.mode,
  };

  try {
    await fetch(BACKEND_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.warn("[backend-client] Failed to notify backend:", err);
  }
}
