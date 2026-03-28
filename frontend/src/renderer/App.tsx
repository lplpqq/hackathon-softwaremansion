import { useEffect, useState } from "react";

interface DesktopSource {
  id: string;
  name: string;
}

declare global {
  interface Window {
    electronAPI: {
      getDesktopSources: () => Promise<DesktopSource[]>;
    };
  }
}

export default function App() {
  const [sources, setSources] = useState<DesktopSource[]>([]);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    const result = await window.electronAPI.getDesktopSources();
    setSources(result);
    setLoading(false);
  }

  useEffect(() => {
    refresh();
  }, []);

  const screens = sources.filter((s) => s.id.startsWith("screen:"));
  const windows = sources.filter((s) => s.id.startsWith("window:"));

  return (
    <main className="app">
      <div className="header">
        <h1>Active Apps</h1>
        <button className="refresh-btn" onClick={refresh} disabled={loading}>
          {loading ? "..." : "Refresh"}
        </button>
      </div>

      {screens.length > 0 && (
        <section>
          <h2 className="section-title">Screens</h2>
          <div className="grid">
            {screens.map((s) => (
              <div key={s.id} className="card screen-card">
                <div className="card-icon">🖥</div>
                <div className="card-name">{s.name}</div>
                <div className="card-id">{s.id}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {windows.length > 0 && (
        <section>
          <h2 className="section-title">Windows ({windows.length})</h2>
          <div className="grid">
            {windows.map((s) => (
              <div key={s.id} className="card window-card">
                <div className="card-icon">▣</div>
                <div className="card-name">{s.name}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {!loading && sources.length === 0 && (
        <p className="empty">No sources found.</p>
      )}
    </main>
  );
}
