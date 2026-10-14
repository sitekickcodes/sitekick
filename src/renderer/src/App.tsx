export function App() {
  const versions = window.sitekick?.versions

  return (
    <main className="app">
      <div className="titlebar" />
      <h1>Sitekick</h1>
      <p className="muted">An agentic workspace for client sites.</p>
      {versions ? (
        <p className="versions">
          Electron {versions.electron} · Chromium {versions.chrome} · Node {versions.node}
        </p>
      ) : (
        <p className="versions">Running in a browser (no Electron preload)</p>
      )}
    </main>
  )
}
