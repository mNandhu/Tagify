import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FolderOpen, Plus, RotateCw, Pencil, Trash2 } from "lucide-react";
import { useToast } from "../components/Toasts";
import { PageHeader } from "../components/ui/PageHeader";
import { Card, Section } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Input, Field } from "../components/ui/Input";
import { Badge } from "../components/ui/Badge";
import { Skeleton, Spinner } from "../components/ui/Skeleton";
import { EmptyState } from "../components/ui/EmptyState";
import { api } from "../lib/api";

type Library = {
  _id: string;
  name?: string;
  path: string;
  indexed_count?: number;
  last_scanned?: string;
};

export default function LibrariesPage() {
  const { push } = useToast();
  const queryClient = useQueryClient();

  // Library changes alter which images the gallery should show. Both the flat
  // feed (`["images", ...]`) and the batch-collapsed grouped view
  // (`["image-groups", ...]`) are cached with a staleTime, so without this the
  // gallery shows stale results — including images from a removed library —
  // until a manual reload. Drop both so they refetch next time they mount.
  const invalidateImageFeed = () => {
    queryClient.invalidateQueries({ queryKey: ["images"] });
    queryClient.invalidateQueries({ queryKey: ["image-groups"] });
  };
  const [libs, setLibs] = useState<Library[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [path, setPath] = useState("");
  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);
  const [rescanning, setRescanning] = useState<Set<string>>(new Set());
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editPath, setEditPath] = useState("");

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
      const updates: Record<
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
            } catch { /* network errors silenced — polling will retry */ }
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
        if (transitioned) {
          refresh();
          invalidateImageFeed();
        }
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

  const refresh = async (opts?: { initial?: boolean }) => {
    if (opts?.initial) setInitialLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const data = await api<Library[]>(`/api/libraries`);
      setLibs(data);
    } catch (e: any) {
      const msg = e?.message || "Failed to load libraries";
      setError(msg);
    } finally {
      if (opts?.initial) setInitialLoading(false);
      else setRefreshing(false);
    }
  };
  useEffect(() => {
    refresh({ initial: true });
  }, []);

  const updateLibrary = async (id: string, data: Partial<Library>) => {
    await api(`/api/libraries/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    refresh();
    invalidateImageFeed();
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
    invalidateImageFeed();
  };

  return (
    <div className="p-6 space-y-5">
      <PageHeader
        icon={FolderOpen}
        title="Libraries"
        count={initialLoading ? undefined : libs.length}
        description="Folders Tagify watches and indexes."
        actions={
          refreshing && !initialLoading ? (
            <span className="flex items-center gap-2 text-xs text-neutral-400">
              <Spinner className="h-3 w-3" /> Refreshing…
            </span>
          ) : undefined
        }
      />

      {/* Add library */}
      <Section title="Add a library" description="Point Tagify at a local folder of images.">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Folder path" className="flex-1 min-w-[220px]">
            <Input
              placeholder="D:/images"
              value={path}
              onChange={(e) => setPath(e.target.value)}
            />
          </Field>
          <Field label="Name (optional)" className="flex-1 min-w-[180px]">
            <Input
              placeholder="My Library"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Button
            variant="success"
            disabled={!path.trim() || adding}
            onClick={async () => {
              if (!path.trim()) return;
              setAdding(true);
              try {
                await api(`/api/libraries`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ path, name: name || undefined }),
                });
                setPath("");
                setName("");
                await refresh();
                invalidateImageFeed();
                push("Library added", "success");
              } catch (e: any) {
                push(e?.message || "Failed to add library", "error");
              } finally {
                setAdding(false);
              }
            }}
          >
            <Plus size={16} />
            {adding ? "Adding…" : "Add library"}
          </Button>
        </div>
      </Section>

      {/* Error banner */}
      {error && !initialLoading && (
        <div className="rounded-lg border border-red-800 bg-red-900/40 p-3 text-sm text-red-200 flex items-start justify-between gap-3">
          <div>{error}</div>
          <Button variant="danger" size="sm" onClick={() => refresh()}>
            Retry
          </Button>
        </div>
      )}

      <div className="grid gap-3">
        {/* Initial loading skeletons */}
        {initialLoading && (
          <>
            {Array.from({ length: 3 }).map((_, i) => (
              <Card key={i} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-48" />
                    <Skeleton className="h-3 w-72" />
                  </div>
                  <div className="flex items-center gap-2">
                    <Skeleton className="h-5 w-20" />
                    <Skeleton className="h-5 w-24" />
                  </div>
                </div>
                <Skeleton className="mt-3 h-7 w-40" />
              </Card>
            ))}
          </>
        )}

        {/* Empty state */}
        {!initialLoading && !libs.length && !error && (
          <EmptyState
            icon={FolderOpen}
            title="No libraries yet"
            description="Add your first library above by entering a folder path — for example D:/images."
          />
        )}

        {/* Libraries list */}
        {!initialLoading &&
          libs.map((l) => (
            <Card key={l._id} hover className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold text-neutral-100 truncate">
                    {l.name || l.path}
                  </div>
                  <div className="text-xs text-neutral-400 truncate">{l.path}</div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {!(progress[l._id]?.scanning || (l as any).scanning) &&
                    typeof l.indexed_count === "number" && (
                      <Badge>{l.indexed_count.toLocaleString()} indexed</Badge>
                    )}
                  {l.last_scanned && (
                    <Badge>
                      <span title={new Date(l.last_scanned).toLocaleString()}>
                        {new Date(l.last_scanned).toLocaleDateString()}
                      </span>
                    </Badge>
                  )}
                  {rescanning.has(l._id) && (
                    <Badge tone="brand">Rescanning…</Badge>
                  )}
                </div>
              </div>

              {progress[l._id]?.scanning && (
                <div className="mt-3">
                  <progress
                    className="w-full h-2 [&::-webkit-progress-bar]:bg-neutral-800 [&::-webkit-progress-value]:bg-purple-600 [&::-moz-progress-bar]:bg-purple-600 rounded"
                    value={Math.max(0, progress[l._id]?.scan_done || 0)}
                    max={Math.max(1, progress[l._id]?.scan_total || 1)}
                    aria-label="Scanning progress"
                  />
                  <div className="mt-1 text-xs text-neutral-400 tabular-nums">
                    {progress[l._id]?.scan_done || 0} /{" "}
                    {progress[l._id]?.scan_total || 0}
                  </div>
                </div>
              )}

              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  size="sm"
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
                  <RotateCw size={14} />
                  {rescanning.has(l._id) ? "Rescanning…" : "Rescan"}
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    setEditId(l._id);
                    setEditName(l.name || "");
                    setEditPath(l.path);
                  }}
                >
                  <Pencil size={14} />
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="dangerSoft"
                  onClick={() => deleteLibrary(l._id)}
                >
                  <Trash2 size={14} />
                  Delete
                </Button>
              </div>
            </Card>
          ))}
      </div>

      {editId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
          <Card className="w-full max-w-md p-5 shadow-xl">
            <div className="text-lg font-semibold mb-4">Edit library</div>
            <div className="space-y-3">
              <Field label="Name" htmlFor="edit_name">
                <Input
                  id="edit_name"
                  placeholder="Friendly name"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                />
              </Field>
              <Field label="Path" htmlFor="edit_path">
                <Input
                  id="edit_path"
                  placeholder="D:/images"
                  value={editPath}
                  onChange={(e) => setEditPath(e.target.value)}
                />
              </Field>
              {editPath !== libs.find((l) => l._id === editId)?.path && (
                <p className="text-xs text-amber-400">
                  Path changed — rescan will start automatically.
                </p>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <Button onClick={() => setEditId(null)}>Cancel</Button>
                <Button
                  variant="success"
                  onClick={async () => {
                    const payload: Partial<Library> = {};
                    if (editName !== undefined)
                      payload.name = editName || undefined;
                    if (editPath) payload.path = editPath;
                    await updateLibrary(editId, payload);
                    setEditId(null);
                    refresh();
                    push("Library saved", "success");
                  }}
                >
                  Save
                </Button>
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
