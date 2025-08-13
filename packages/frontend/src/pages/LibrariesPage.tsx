import { useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "../components/Toasts";

type Library = {
  _id: string;
  name?: string;
  path: string;
  indexed_count?: number;
  last_scanned?: string;
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export default function LibrariesPage() {
  const { push } = useToast();
  const [libs, setLibs] = useState<Library[]>([]);
  const [path, setPath] = useState("");
  const [name, setName] = useState("");
  const [rescanning, setRescanning] = useState<Set<string>>(new Set());
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editPath, setEditPath] = useState("");
  const [editRescan, setEditRescan] = useState(false);

  // Polling progress map
  const [progress, setProgress] = useState<
    Record<string, { scanning: boolean; scan_total: number; scan_done: number }>
  >({});
  const prevScanningRef = useRef<Record<string, boolean>>({});

  // Compute which libraries need polling (those currently scanning)
  const scanningIds = useMemo(
    () => libs.filter((l: any) => l && (l as any).scanning).map((l) => l._id),
    [libs]
  );

  // Poll scan progress for scanning libraries only
  useEffect(() => {
    if (!scanningIds.length) return;
    let timer: number | undefined;
    let cancelled = false;
    const tick = async () => {
      let updates: Record<
        string,
        { scanning: boolean; scan_total: number; scan_done: number }
      > = {};
      try {
        await Promise.all(
          scanningIds.map(async (id) => {
            try {
              const r = await fetch(`/api/libraries/${id}/progress`);
              if (!r.ok) return;
              const j = await r.json();
              updates[id] = {
                scanning: !!j.scanning,
                scan_total: j.scan_total || 0,
                scan_done: j.scan_done || 0,
              };
            } catch {}
          })
        );
        // Detect scanning -> done transitions to refresh once
        const prev = prevScanningRef.current;
        let transitioned = false;
        for (const [id, u] of Object.entries(updates)) {
          if (prev[id] && !u.scanning) transitioned = true;
        }
        prevScanningRef.current = Object.fromEntries(
          Object.entries(updates).map(([id, u]) => [id, u.scanning])
        );
        if (transitioned) refresh();
        if (!cancelled) setProgress((p) => ({ ...p, ...updates }));
      } finally {
        const anyScanning = Object.values(updates).some((u) => u.scanning);
        if (!cancelled && anyScanning) timer = window.setTimeout(tick, 1500);
      }
    };
    tick();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [scanningIds]);

  const refresh = async () => setLibs(await api<Library[]>(`/api/libraries`));
  useEffect(() => {
    refresh();
  }, []);

  const updateLibrary = async (id: string, data: Partial<Library>) => {
    await api(`/api/libraries/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    refresh();
  };

  const deleteLibrary = async (id: string) => {
    if (
      !confirm(
        "Delete this library? This will remove its indexed images and thumbnails."
      )
    )
      return;
    await api(`/api/libraries/${id}`, { method: "DELETE" });
    refresh();
  };

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-end gap-2">
        <div>
          <label className="block text-sm">Path</label>
          <input
            placeholder="D:/images"
            className="px-2 py-1 rounded bg-neutral-900 border border-neutral-800"
            value={path}
            onChange={(e) => setPath(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-sm">Name</label>
          <input
            placeholder="My Library"
            className="px-2 py-1 rounded bg-neutral-900 border border-neutral-800"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <button
          className="px-3 py-2 rounded bg-emerald-600 hover:bg-emerald-500"
          onClick={async () => {
            await api(`/api/libraries`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ path, name: name || undefined }),
            });
            setPath("");
            setName("");
            refresh();
            push("Library added", "success");
          }}
        >
          + Add Library
        </button>
      </div>
      <div className="grid gap-3">
        {libs.map((l) => (
          <div
            key={l._id}
            className="rounded border border-neutral-800 bg-neutral-900 p-3 card-hover"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-semibold">{l.name || l.path}</div>
                <div className="text-xs text-neutral-400">{l.path}</div>
              </div>
              <div className="flex items-center gap-2">
                {!(progress[l._id]?.scanning || (l as any).scanning) &&
                  typeof l.indexed_count === "number" && (
                    <span className="px-2 py-0.5 text-xs rounded bg-neutral-800 border border-neutral-700">
                      {l.indexed_count} indexed
                    </span>
                  )}
                {l.last_scanned && (
                  <span
                    className="px-2 py-0.5 text-xs rounded bg-neutral-800 border border-neutral-700"
                    title={new Date(l.last_scanned).toLocaleString()}
                  >
                    {new Date(l.last_scanned).toLocaleDateString()}
                  </span>
                )}
                {rescanning.has(l._id) && (
                  <span className="px-2 py-0.5 text-xs rounded bg-purple-900/40 border border-purple-700 text-purple-300">
                    Rescanning…
                  </span>
                )}
                {progress[l._id]?.scanning && (
                  <div className="mt-2 w-full min-w-[200px]">
                    <progress
                      className="w-full h-2 [&::-webkit-progress-bar]:bg-neutral-800 [&::-webkit-progress-value]:bg-purple-600 [&::-moz-progress-bar]:bg-purple-600 rounded"
                      value={Math.max(0, progress[l._id]?.scan_done || 0)}
                      max={Math.max(1, progress[l._id]?.scan_total || 1)}
                      aria-label="Scanning progress"
                    />
                    <div className="mt-1 text-xs text-neutral-400">
                      {progress[l._id]?.scan_done || 0} /{" "}
                      {progress[l._id]?.scan_total || 0}
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                className="px-2 py-1 text-xs rounded bg-neutral-800 hover:bg-neutral-700"
                onClick={async () => {
                  setRescanning((s) => new Set(s).add(l._id));
                  try {
                    await api(`/api/libraries/${l._id}/rescan`, {
                      method: "POST",
                    });
                    push(`Rescan started for ${l.name || l.path}`, "info");
                  } finally {
                    refresh();
                    setRescanning((s) => {
                      const n = new Set(s);
                      n.delete(l._id);
                      return n;
                    });
                    push(`Rescan requested`, "success");
                  }
                }}
                disabled={rescanning.has(l._id)}
              >
                {rescanning.has(l._id) ? "Rescanning…" : "Rescan"}
              </button>
              <button
                className="px-2 py-1 text-xs rounded bg-neutral-800 hover:bg-neutral-700"
                onClick={() => {
                  setEditId(l._id);
                  setEditName(l.name || "");
                  setEditPath(l.path);
                  setEditRescan(false);
                }}
              >
                Edit
              </button>
              <button
                className="px-2 py-1 text-xs rounded bg-red-600 hover:bg-red-500"
                onClick={() => deleteLibrary(l._id)}
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>

      {editId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
          <div className="w-full max-w-md rounded border border-neutral-800 bg-neutral-900 p-4 shadow-xl">
            <div className="text-lg font-semibold mb-3">Edit Library</div>
            <div className="space-y-3">
              <div>
                <label className="block text-sm mb-1">Name</label>
                <input
                  placeholder="Friendly name"
                  className="w-full px-2 py-2 rounded bg-neutral-950 border border-neutral-800"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm mb-1">Path</label>
                <input
                  placeholder="D:/images"
                  className="w-full px-2 py-2 rounded bg-neutral-950 border border-neutral-800"
                  value={editPath}
                  onChange={(e) => setEditPath(e.target.value)}
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={editRescan}
                  onChange={(e) => setEditRescan(e.target.checked)}
                />
                Rescan after saving
              </label>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  className="px-3 py-2 rounded bg-neutral-800 hover:bg-neutral-700"
                  onClick={() => setEditId(null)}
                >
                  Cancel
                </button>
                <button
                  className="px-3 py-2 rounded bg-emerald-600 hover:bg-emerald-500"
                  onClick={async () => {
                    const payload: Partial<Library> = {};
                    if (editName !== undefined)
                      payload.name = editName || undefined;
                    if (editPath) payload.path = editPath;
                    await updateLibrary(editId, payload);
                    if (editRescan) {
                      setRescanning((s) => new Set(s).add(editId));
                      try {
                        await api(`/api/libraries/${editId}/rescan`, {
                          method: "POST",
                        });
                        push("Rescan started", "info");
                      } finally {
                        setRescanning((s) => {
                          const n = new Set(s);
                          n.delete(editId);
                          return n;
                        });
                      }
                    }
                    setEditId(null);
                    refresh();
                    push("Library saved", "success");
                  }}
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
