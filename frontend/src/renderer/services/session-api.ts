import type { SessionData } from "../types";

const BACKEND_BASE = "https://4403-185-28-19-74.ngrok-free.app";

export async function createSession(): Promise<SessionData> {
  const res = await fetch(`${BACKEND_BASE}/create-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });

  if (!res.ok) {
    throw new Error(`[session-api] create-session failed: ${res.status}`);
  }

  return (await res.json()) as SessionData;
}
