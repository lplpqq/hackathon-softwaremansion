const BACKEND_BASE = "wss://4403-185-28-19-74.ngrok-free.app";

export function connectAnalysisWs(wsPath: string): WebSocket {
  const url = `${BACKEND_BASE}${wsPath}`;
  return new WebSocket(url);
}
