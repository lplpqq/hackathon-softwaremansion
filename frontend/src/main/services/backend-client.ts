import { FullContext } from "../types";

const BACKEND_URL = "http://localhost:8000/api/context";

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
