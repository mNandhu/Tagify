import { useEffect, useState } from "react";

type Library = { _id: string; name?: string; path: string };

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export default function LibrariesPage() {
  const [libs, setLibs] = useState<Library[]>([]);
  const [path, setPath] = useState("");
  const [name, setName] = useState("");

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
            className="rounded border border-neutral-800 bg-neutral-900 p-3"
          >
            <div className="font-semibold">{l.name || l.path}</div>
            <div className="text-xs text-neutral-400">{l.path}</div>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                className="px-2 py-1 text-xs rounded bg-neutral-800 hover:bg-neutral-700"
                onClick={async () => {
                  await api(`/api/libraries/${l._id}/rescan`, {
                    method: "POST",
                  });
                  refresh();
                }}
              >
                Rescan
              </button>
              <button
                className="px-2 py-1 text-xs rounded bg-neutral-800 hover:bg-neutral-700"
                onClick={async () => {
                  const newName = prompt("Edit name", l.name || "");
                  if (newName !== null)
                    await updateLibrary(l._id, { name: newName });
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
    </div>
  );
}
