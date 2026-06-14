import { useCallback, useEffect, useMemo, useState } from "react";
import { Workflow, Save, Trash2, Play, X, Plus } from "lucide-react";
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

// A clickable JSON tree: leaves pin their dot-path into the active field.
// Exported for unit testing the path construction (the load-bearing, silent-on-
// failure interaction: click leaf -> correct dot-path).
export function JsonTree({
  value,
  path,
  onPin,
  depth = 0,
}: {
  value: unknown;
  path: string;
  onPin: (path: string) => void;
  depth?: number;
}) {
  const [open, setOpen] = useState(depth < 2);
  const isObj = value && typeof value === "object";

  if (!isObj) {
    return (
      <button
        onClick={() => onPin(path)}
        className="group inline-flex items-baseline gap-2 text-left hover:bg-purple-500/10 rounded px-1 -mx-1 w-full"
        title={`Pin ${path}`}
      >
        <span className="text-emerald-300 break-all">{JSON.stringify(value)}</span>
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
        return (
          <div key={k} className="py-0.5">
            {leaf ? (
              <div className="flex items-baseline gap-2">
                <span className="text-sky-300 shrink-0">{k}:</span>
                <JsonTree value={v} path={childPath} onPin={onPin} depth={depth + 1} />
              </div>
            ) : (
              <div>
                <button
                  onClick={() => setOpen((o) => !o)}
                  className="text-sky-300 hover:text-sky-200"
                >
                  {open ? "▾" : "▸"} {k}
                </button>
                {open && (
                  <JsonTree value={v} path={childPath} onPin={onPin} depth={depth + 1} />
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
  const [graph, setGraph] = useState<unknown>(null);
  const [activeField, setActiveField] = useState<RuleField>("prompt");
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [busy, setBusy] = useState(false);

  const loadSignatures = useCallback(() => {
    fetchSignatures()
      .then(setSigs)
      .catch((e) => push(`Failed to load signatures: ${String(e)}`, "error"));
  }, [push]);

  useEffect(() => loadSignatures(), [loadSignatures]);

  const selectSig = useCallback(
    async (row: SignatureRow) => {
      setSelected(row);
      setPreview(null);
      setGraph(null);
      try {
        const [rs, wf] = await Promise.all([
          fetchRuleset(row.workflow_sig),
          fetchWorkflow(row.sample_image_id),
        ]);
        setFields(rs.fields || {});
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
    [push],
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
                <div className="flex items-center gap-2">
                  <Button onClick={() => void runPreview()} disabled={busy}>
                    <Play size={14} /> Preview
                  </Button>
                  <Button variant="primary" onClick={() => void save()} disabled={busy}>
                    <Save size={14} /> Save
                  </Button>
                  <Button onClick={() => void remove()} disabled={busy}>
                    <Trash2 size={14} /> Delete
                  </Button>
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
              <div className="rounded-lg border border-neutral-800 bg-neutral-950/50 p-3 overflow-auto max-h-[70vh]">
                <div className="text-xs text-neutral-400 mb-2">
                  Sample graph — click a value to pin it to{" "}
                  <span className="text-purple-300">{FIELD_LABEL[activeField]}</span>
                </div>
                {graph ? (
                  <div className="font-mono text-xs leading-relaxed">
                    <JsonTree value={graph} path="" onPin={pinPath} />
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
