import { useEffect, useMemo, useState } from "react";

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
  const [libs, setLibs] = useState<Library[]>([]);
  const [path, setPath] = useState("");
  const [name, setName] = useState("");
  const [rescanning, setRescanning] = useState<Set<string>>(new Set());
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editPath, setEditPath] = useState("");
  const [editRescan, setEditRescan] = useState(false);

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
                {typeof l.indexed_count === "number" && (
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
                  } finally {
                    refresh();
                    setRescanning((s) => {
                      const n = new Set(s);
                      n.delete(l._id);
                      return n;
                    });
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
