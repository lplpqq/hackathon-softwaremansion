import { useEffect, useState } from "react";

interface ActiveWindow {
  pid: number;
  name: string;
  title: string;
}

declare global {
  interface Window {
    electronAPI: {
      getDesktopSources: () => Promise<{ id: string; name: string }[]>;
      getActiveWindows: () => Promise<ActiveWindow[]>;
      onActiveWindowChanged: (callback: (windows: ActiveWindow[]) => void) => void;
    };
  }
}

export default function App() {
  const [windows, setWindows] = useState<ActiveWindow[]>([]);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    const result = await window.electronAPI.getActiveWindows();
    setWindows(result);
    setLoading(false);
  }

  useEffect(() => {
    refresh();
    window.electronAPI.onActiveWindowChanged((wins) => {
      setWindows(wins);
    });
  }, []);

  return (
    <main className="app">
      <div className="header">
        <h1>Active Apps</h1>
        <button className="refresh-btn" onClick={refresh} disabled={loading}>
          {loading ? "..." : "Refresh"}
        </button>
      </div>

      {!loading && windows.length === 0 && (
        <p className="empty">No windows found.</p>
      )}


      <div className="grid">
        {windows.map((w) => (
          <div key={w.pid} className="card">
            <div className="card-process">{w.name}</div>
            <div className="card-title">{w.title}</div>
            <div className="card-pid">PID {w.pid}</div>
          </div>
        ))}
      </div>
    </main>
  );
}
