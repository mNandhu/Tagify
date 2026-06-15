import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useBlocker } from "react-router-dom";
import { Workflow, Save, Trash2, Play, X, Plus, Search, AlertTriangle } from "lucide-react";
import { PageHeader } from "../components/ui/PageHeader";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { useToast } from "../components/Toasts";
import {
  RULE_FIELDS,
  type RuleField,
  type RuleFields,
  type SignatureRow,
  type PreviewResult,
  fetchSignatures,
  fetchRuleset,
  saveRuleset,
  deleteRuleset,
  previewRuleset,
  fetchWorkflow,
} from "../lib/gen";

const FIELD_LABEL: Record<RuleField, string> = {
  prompt: "Positive prompt",
  negative: "Negative prompt",
  seed: "Seed",
  model: "Model",
  sampler: "Sampler",
  steps: "Steps",
  cfg: "CFG",
};

// Does a key or any descendant value contain the (lowercased) search term?
// Drives both the highlight and the auto-expand: a node matches when its own key
// matches (e.g. node id "34"), or any nested value does (a class_type like
// "CLIPTextEncode", a prompt word like "masterpiece"). Exported for unit testing.
export function matchesQuery(
  value: unknown,
  query: string,
  key?: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  if (key !== undefined && key.toLowerCase().includes(q)) return true;
  if (value === null || value === undefined) return false;
  if (typeof value !== "object") return String(value).toLowerCase().includes(q);
  const entries = Array.isArray(value)
    ? value.map((v, i) => [String(i), v] as const)
    : Object.entries(value as Record<string, unknown>);
  return entries.some(([k, v]) => matchesQuery(v, q, k));
}

// Flatten every leaf whose key or value contains the term into pinnable rows,
// so matches can be surfaced at the top of the panel (no scrolling to find the
// buried node). Each row carries its rooted dot-path — the same path clicking the
// tree leaf would pin. Exported for unit testing.
export type GraphMatch = { path: string; value: unknown };

export function collectMatches(
  value: unknown,
  query: string,
  path = "",
  key = "",
): GraphMatch[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  if (value === null || typeof value !== "object") {
    const keyHit = key.toLowerCase().includes(q);
    const valHit = value != null && String(value).toLowerCase().includes(q);
    return keyHit || valHit ? [{ path, value }] : [];
  }
  const entries = Array.isArray(value)
    ? value.map((v, i) => [String(i), v] as const)
    : Object.entries(value as Record<string, unknown>);
  return entries.flatMap(([k, v]) =>
    collectMatches(v, q, path ? `${path}.${k}` : k, k),
  );
}

const HIT = "bg-yellow-500/25 text-yellow-100 rounded px-0.5";

// A clickable JSON tree: leaves pin their dot-path into the active field.
// `query` highlights matching keys/values and force-opens the branches that
// contain a match (the tree is collapsed at depth >= 2), so a search reveals the
// whole matching node — its id *and* its class_type stay in view, never pruned.
// Exported for unit testing the path construction (the load-bearing, silent-on-
// failure interaction: click leaf -> correct dot-path).
export function JsonTree({
  value,
  path,
  onPin,
  depth = 0,
  query = "",
}: {
  value: unknown;
  path: string;
  onPin: (path: string) => void;
  depth?: number;
  query?: string;
}) {
  const [open, setOpen] = useState(depth < 2);
  const isObj = value && typeof value === "object";
  const hasQuery = query.trim().length > 0;

  if (!isObj) {
    const valHit = hasQuery && matchesQuery(value, query);
    return (
      <button
        onClick={() => onPin(path)}
        data-graph-path={path}
        className="group inline-flex items-baseline gap-2 text-left hover:bg-purple-500/10 rounded px-1 -mx-1 w-full"
        title={`Pin ${path}`}
      >
        <span className={valHit ? `break-all ${HIT}` : "text-emerald-300 break-all"}>
          {JSON.stringify(value)}
        </span>
        <span className="text-[10px] text-neutral-600 group-hover:text-purple-300 ml-auto shrink-0">
          {path}
        </span>
      </button>
    );
  }

  const entries = Array.isArray(value)
    ? value.map((v, i) => [String(i), v] as const)
    : Object.entries(value as Record<string, unknown>);

  return (
    <div className={depth === 0 ? "" : "pl-3 border-l border-neutral-800"}>
      {entries.map(([k, v]) => {
        const childPath = path ? `${path}.${k}` : k;
        const leaf = !v || typeof v !== "object";
        const keyHit = hasQuery && k.toLowerCase().includes(query.trim().toLowerCase());
        const keyCls = keyHit ? HIT : "text-sky-300";
        // Force a branch open when it (or a descendant) matches the search.
        const childOpen = open || (hasQuery && matchesQuery(v, query, k));
        return (
          <div key={k} className="py-0.5">
            {leaf ? (
              <div className="flex items-baseline gap-2">
                <span className={`shrink-0 ${keyCls}`}>{k}:</span>
                <JsonTree
                  value={v}
                  path={childPath}
                  onPin={onPin}
                  depth={depth + 1}
                  query={query}
                />
              </div>
            ) : (
              <div>
                <button
                  onClick={() => setOpen((o) => !o)}
                  className={`hover:text-sky-200 ${keyCls}`}
                >
                  {childOpen ? "▾" : "▸"} {k}
                </button>
                {childOpen && (
                  <JsonTree
                    value={v}
                    path={childPath}
                    onPin={onPin}
                    depth={depth + 1}
                    query={query}
                  />
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function RulesPage() {
  const { push } = useToast();
  const [sigs, setSigs] = useState<SignatureRow[]>([]);
  const [selected, setSelected] = useState<SignatureRow | null>(null);
  const [fields, setFields] = useState<RuleFields>({});
  const savedFields = useRef<RuleFields>({});
  const [graph, setGraph] = useState<unknown>(null);
  const [activeField, setActiveField] = useState<RuleField>("prompt");
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [busy, setBusy] = useState(false);
  // Search *within* the selected sample graph — find a node by id, class_type, or
  // a prompt word and see where it lives so its dot-path can be pinned.
  const [graphQuery, setGraphQuery] = useState("");

  const loadSignatures = useCallback(() => {
    fetchSignatures()
      .then(setSigs)
      .catch((e) => push(`Failed to load signatures: ${String(e)}`, "error"));
  }, [push]);

  useEffect(() => loadSignatures(), [loadSignatures]);

  const isDirty = useMemo(
    () => JSON.stringify(fields) !== JSON.stringify(savedFields.current),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fields],
  );

  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  const blocker = useBlocker(isDirty);
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    if (confirm("You have unsaved changes. Leave anyway?")) {
      blocker.proceed();
    } else {
      blocker.reset();
    }
  }, [blocker]);

  const selectSig = useCallback(
    async (row: SignatureRow) => {
      if (isDirty && !confirm("You have unsaved changes. Discard and switch signature?"))
        return;
      setSelected(row);
      setPreview(null);
      setGraph(null);
      try {
        const [rs, wf] = await Promise.all([
          fetchRuleset(row.workflow_sig),
          fetchWorkflow(row.sample_image_id),
        ]);
        const loaded = rs.fields || {};
        savedFields.current = loaded;
        setFields(loaded);
        // Root the tree at the raw doc so pinned paths read `prompt.<node>...`.
        const g: Record<string, unknown> = {};
        if (wf && (wf as { prompt?: unknown }).prompt != null)
          g.prompt = (wf as { prompt?: unknown }).prompt;
        if (wf && (wf as { workflow?: unknown }).workflow != null)
          g.workflow = (wf as { workflow?: unknown }).workflow;
        setGraph(g);
      } catch (e) {
        push(`Failed to load ruleset: ${String(e)}`, "error");
      }
    },
    [push, isDirty],
  );

  const pinPath = useCallback(
    (path: string) => {
      setFields((f) => {
        const cur = f[activeField] || [];
        if (cur.includes(path)) return f;
        return { ...f, [activeField]: [...cur, path] };
      });
      push(`Pinned ${path} → ${FIELD_LABEL[activeField]}`, "info");
    },
    [activeField, push],
  );

  const removePath = (field: RuleField, path: string) =>
    setFields((f) => ({
      ...f,
      [field]: (f[field] || []).filter((p) => p !== path),
    }));

  const runPreview = useCallback(async () => {
    if (!selected) return;
    setBusy(true);
    try {
      setPreview(await previewRuleset(selected.sample_image_id, fields));
    } catch (e) {
      push(`Preview failed: ${String(e)}`, "error");
    } finally {
      setBusy(false);
    }
  }, [selected, fields, push]);

  const save = useCallback(async () => {
    if (!selected) return;
    setBusy(true);
    try {
      await saveRuleset(selected.workflow_sig, fields);
      savedFields.current = fields;
      push("Ruleset saved · reprojecting this signature", "success");
      loadSignatures();
    } catch (e) {
      push(`Save failed: ${String(e)}`, "error");
    } finally {
      setBusy(false);
    }
  }, [selected, fields, push, loadSignatures]);

  const remove = useCallback(async () => {
    if (!selected) return;
    if (!confirm("Delete this ruleset and reproject with built-in rules?")) return;
    setBusy(true);
    try {
      await deleteRuleset(selected.workflow_sig);
      savedFields.current = {};
      setFields({});
      push("Ruleset deleted", "info");
      loadSignatures();
    } catch (e) {
      push(`Delete failed: ${String(e)}`, "error");
    } finally {
      setBusy(false);
    }
  }, [selected, push, loadSignatures]);

  const previewGen = preview?.gen;
  const firedByField = useMemo(() => preview?.paths ?? {}, [preview]);

  // Matches surfaced at the top of the graph panel so a hit deep in a large graph
  // is reachable instead of scrolling to find it.
  const matches = useMemo(
    () => (graph && graphQuery.trim() ? collectMatches(graph, graphQuery) : []),
    [graph, graphQuery],
  );

  // Scroll the matched leaf into view so its surrounding node (class_type,
  // sibling inputs) is readable — the user picks the right hit before pinning.
  const graphScrollRef = useRef<HTMLDivElement>(null);
  const revealPath = useCallback((path: string) => {
    const el = graphScrollRef.current?.querySelector<HTMLElement>(
      `[data-graph-path="${path.replace(/"/g, '\\"')}"]`,
    );
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    // Brief flash so the eye lands on the right row after the scroll.
    el.classList.add("ring-1", "ring-purple-400", "rounded");
    setTimeout(() => el.classList.remove("ring-1", "ring-purple-400", "rounded"), 1200);
  }, []);

  return (
    <div className="p-6 space-y-4">
      <PageHeader
        icon={Workflow}
        title="Extraction Rules"
        count={sigs.length}
        description="Pin where each generation field lives in your custom workflows."
      />

      {sigs.length === 0 ? (
        <EmptyState
          icon={Workflow}
          title="No workflow signatures yet"
          description="Scan a library of ComfyUI images first. Each distinct workflow shape appears here for mapping."
        />
      ) : (
        <div className="grid grid-cols-12 gap-4">
          {/* Signature picker */}
          <div className="col-span-12 lg:col-span-3 space-y-1.5">
            {sigs.map((s) => (
              <button
                key={s.workflow_sig}
                onClick={() => void selectSig(s)}
                className={`w-full text-left px-3 py-2 rounded-lg border text-sm ${
                  selected?.workflow_sig === s.workflow_sig
                    ? "bg-neutral-800 border-neutral-600"
                    : "bg-neutral-900 border-neutral-800 hover:border-neutral-700"
                }`}
              >
                <div className="font-mono text-xs truncate">{s.workflow_sig}</div>
                <div className="flex items-center gap-2 mt-1 text-[11px]">
                  <span className="text-neutral-400">{s.count} imgs</span>
                  {s.needs_mapping > 0 && (
                    <span className="px-1.5 rounded-full bg-amber-900/40 border border-amber-800 text-amber-200">
                      {s.needs_mapping} unmapped
                    </span>
                  )}
                  {s.has_ruleset && (
                    <span className="px-1.5 rounded-full bg-emerald-900/40 border border-emerald-800 text-emerald-200">
                      ruleset
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>

          {!selected ? (
            <div className="col-span-12 lg:col-span-9 text-neutral-500 text-sm">
              Select a signature to map its fields.
            </div>
          ) : (
            <div className="col-span-12 lg:col-span-9 grid grid-cols-1 xl:grid-cols-2 gap-4">
              {/* Field editors + actions */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <Button onClick={() => void runPreview()} disabled={busy}>
                    <Play size={14} /> Preview
                  </Button>
                  <Button variant="primary" onClick={() => void save()} disabled={busy}>
                    <Save size={14} /> Save
                    {isDirty && (
                      <span className="ml-1 w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                    )}
                  </Button>
                  <Button onClick={() => void remove()} disabled={busy}>
                    <Trash2 size={14} /> Delete
                  </Button>
                  {isDirty && (
                    <span className="flex items-center gap-1 text-[11px] text-amber-400">
                      <AlertTriangle size={12} /> Unsaved changes
                    </span>
                  )}
                </div>

                {RULE_FIELDS.map((field) => (
                  <div
                    key={field}
                    className={`rounded-lg border p-2.5 ${
                      activeField === field
                        ? "border-purple-600 bg-purple-500/5"
                        : "border-neutral-800 bg-neutral-900"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <button
                        onClick={() => setActiveField(field)}
                        className="text-sm font-medium inline-flex items-center gap-1.5"
                        title="Make this the target for tree clicks"
                      >
                        <Plus
                          size={13}
                          className={
                            activeField === field
                              ? "text-purple-300"
                              : "text-neutral-600"
                          }
                        />
                        {FIELD_LABEL[field]}
                      </button>
                      {previewGen != null && (
                        <span className="text-[11px] text-neutral-400 truncate max-w-[55%]">
                          → {String((previewGen as Record<string, unknown>)[field] ?? "—")}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {(fields[field] || []).map((p) => {
                        const fired = (firedByField[field] || []).find(
                          (r) => r.path === p,
                        );
                        const ok = fired && fired.coerced != null;
                        return (
                          <span
                            key={p}
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-mono border ${
                              preview
                                ? ok
                                  ? "bg-emerald-900/30 border-emerald-800 text-emerald-100"
                                  : "bg-neutral-800 border-neutral-700 text-neutral-400"
                                : "bg-neutral-800 border-neutral-700"
                            }`}
                            title={
                              fired ? `resolved: ${String(fired.coerced)}` : undefined
                            }
                          >
                            {p}
                            <button
                              onClick={() => removePath(field, p)}
                              className="hover:text-white"
                              aria-label={`Remove ${p}`}
                            >
                              <X size={11} />
                            </button>
                          </span>
                        );
                      })}
                      {(fields[field] || []).length === 0 && (
                        <span className="text-[11px] text-neutral-600">
                          built-in extraction (click a tree leaf to override)
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Raw graph tree */}
              <div
                ref={graphScrollRef}
                className="rounded-lg border border-neutral-800 bg-neutral-950/50 p-3 overflow-auto max-h-[70vh]"
              >
                {/* Sticky header: stays put while the tree scrolls, so the search
                    box and the surfaced matches are always reachable. */}
                <div className="sticky -top-3 -mx-3 -mt-3 px-3 pt-3 pb-2 bg-neutral-950 z-10 border-b border-neutral-800">
                  <div className="text-xs text-neutral-400 mb-2">
                    Sample graph — click a value to pin it to{" "}
                    <span className="text-purple-300">{FIELD_LABEL[activeField]}</span>
                  </div>
                  <div className="relative">
                    <Search
                      size={14}
                      className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-500 pointer-events-none"
                    />
                    <input
                      type="search"
                      value={graphQuery}
                      onChange={(e) => setGraphQuery(e.target.value)}
                      placeholder="Find a node — id, class_type, or prompt word (e.g. masterpiece)"
                      className="w-full pl-8 pr-2 py-1.5 rounded-lg bg-neutral-900 border border-neutral-800 text-xs placeholder:text-neutral-600 focus:border-neutral-600 focus:outline-none"
                    />
                  </div>
                  {graphQuery.trim() && (
                    <div className="mt-2">
                      <div className="text-[11px] text-neutral-400 mb-1">
                        {matches.length === 0
                          ? "No matches in this graph"
                          : `${matches.length} match${matches.length > 1 ? "es" : ""} — click to jump to it; + pins to ${FIELD_LABEL[activeField]}`}
                      </div>
                      <div className="max-h-40 overflow-auto space-y-0.5">
                        {matches.slice(0, 100).map((m) => (
                          <div
                            key={m.path}
                            className="flex items-baseline gap-1 rounded hover:bg-purple-500/10"
                          >
                            <button
                              onClick={() => revealPath(m.path)}
                              title={`Jump to ${m.path}`}
                              className="flex-1 min-w-0 text-left flex items-baseline gap-2 px-1.5 py-1 font-mono text-[11px]"
                            >
                              <span className="text-purple-300 shrink-0">{m.path}</span>
                              <span className="text-neutral-400 truncate">
                                {String(m.value)}
                              </span>
                            </button>
                            <button
                              onClick={() => pinPath(m.path)}
                              title={`Pin ${m.path} → ${FIELD_LABEL[activeField]}`}
                              aria-label={`Pin ${m.path}`}
                              className="shrink-0 px-1.5 py-1 text-neutral-500 hover:text-purple-300"
                            >
                              <Plus size={13} />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                {graph ? (
                  <div className="font-mono text-xs leading-relaxed">
                    <JsonTree
                      value={graph}
                      path=""
                      onPin={pinPath}
                      query={graphQuery}
                    />
                  </div>
                ) : (
                  <div className="text-neutral-500 text-sm">Loading graph…</div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
