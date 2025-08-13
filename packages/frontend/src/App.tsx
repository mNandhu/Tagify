import { useEffect, useMemo, useState } from "react";

type Library = { _id: string; name?: string; path: string };
type ImageDoc = {
  _id: string;
  path: string;
  thumb_rel?: string;
  width?: number;
  height?: number;
  tags?: string[];
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

function AddLibraryForm({ onAdded }: { onAdded: (lib: Library) => void }) {
  const [path, setPath] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="flex gap-2 items-end"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          const lib = await api<Library>(`/api/libraries`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path, name: name || undefined }),
          });
          onAdded(lib);
        } catch (e) {
          alert(`Failed: ${e}`);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div>
        <label className="block text-sm">Path</label>
        <input
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="D:/images"
          className="px-2 py-1 rounded bg-neutral-800 border border-neutral-700"
          required
        />
      </div>
      <div>
        <label className="block text-sm">Name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="My Library"
          className="px-2 py-1 rounded bg-neutral-800 border border-neutral-700"
        />
      </div>
      <button
        disabled={busy}
        className="px-3 py-2 bg-emerald-600 hover:bg-emerald-500 rounded"
      >
        {busy ? "Adding..." : "Add Library"}
      </button>
    </form>
  );
}

function Libraries({ onSelect }: { onSelect: (lib: Library) => void }) {
  const [libs, setLibs] = useState<Library[]>([]);
  const refresh = async () => {
    setLibs(await api<Library[]>(`/api/libraries`));
  };
  useEffect(() => {
    refresh();
  }, []);
  return (
    <div className="space-y-2">
      <AddLibraryForm onAdded={() => refresh()} />
      <div className="flex flex-wrap gap-2">
        {libs.map((l) => (
          <button
            key={l._id}
            onClick={() => onSelect(l)}
            className="px-3 py-2 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700"
            title={l.path}
          >
            {l.name || l.path}
          </button>
        ))}
      </div>
    </div>
  );
}

function Gallery({ libraryId }: { libraryId?: string }) {
  const [images, setImages] = useState<ImageDoc[]>([]);
  useEffect(() => {
    (async () => {
      const q = libraryId ? `?tags=` : ""; // simple placeholder; real filter by library TBD
      setImages(await api<ImageDoc[]>(`/api/images${q}`));
    })();
  }, [libraryId]);
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-2">
      {images.map((img) => (
        <div key={img._id} className="bg-neutral-800 rounded overflow-hidden">
          {img.thumb_rel ? (
            <img
              src={`/api/thumbs/${img.thumb_rel}`}
              alt="thumb"
              className="w-full h-40 object-cover"
              loading="lazy"
            />
          ) : (
            <div className="w-full h-40 bg-neutral-700" />
          )}
          <div className="p-2 text-xs truncate" title={img.path}>
            {img._id}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function App() {
  const [status, setStatus] = useState("loading...");
  const [activeLib, setActiveLib] = useState<Library | undefined>();
  useEffect(() => {
    fetch("/api/health")
      .then(async (r) => setStatus((await r.json()).status))
      .catch(() => setStatus("offline"));
  }, []);
  return (
    <div className="min-h-dvh bg-neutral-900 text-white">
      <header className="p-4 border-b border-neutral-800 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Tagify — Test UI</h1>
        <div className="text-sm">Backend: {status}</div>
      </header>
      <main className="p-4 space-y-4">
        <Libraries onSelect={setActiveLib} />
        <Gallery libraryId={activeLib?._id} />
      </main>
    </div>
  );
}
