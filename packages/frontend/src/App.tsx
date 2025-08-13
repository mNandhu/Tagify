import { useEffect, useState } from "react";

function App() {
  const [status, setStatus] = useState("loading...");
  useEffect(() => {
    fetch("/api/health")
      .then(async (r) => setStatus((await r.json()).status))
      .catch(() => setStatus("offline"));
  }, []);
  return (
    <div className="min-h-dvh flex items-center justify-center bg-neutral-900 text-white">
      <div className="text-center space-y-3">
        <h1 className="text-3xl font-bold">Tagify</h1>
        <p>Backend status: {status}</p>
      </div>
    </div>
  );
}
export default App;
