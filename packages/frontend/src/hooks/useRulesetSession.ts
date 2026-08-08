import { useCallback, useMemo, useRef, useState } from "react";
import {
  deleteRuleset,
  fetchRuleset,
  fetchWorkflow,
  saveRuleset,
  type RuleField,
  type RuleFields,
  type SignatureRow,
} from "../lib/gen";

/**
 * One editing session over a signature's extraction Ruleset.
 *
 * There are four ways to leave or lose an edit — browser unload, in-app
 * navigation, switching signature, deleting the ruleset — and they used to
 * re-implement the dirty check three different ways with no shared definition
 * of dirty. Worse, the baseline ref was reassigned in three separate places;
 * missing one leaves the page permanently dirty, so every subsequent navigation
 * prompts about changes that were already saved.
 *
 * This owns the loaded-vs-edited state, the single definition of dirty, and
 * every transition that resets the baseline (load / save / delete). The page
 * renders it; useUnsavedChangesGuard wires the exit paths to `isDirty`.
 *
 * See CONTEXT.md › Generation metadata for what a Ruleset does.
 */

export type RulesetSession = {
  selected: SignatureRow | null;
  fields: RuleFields;
  graph: unknown;
  isDirty: boolean;
  busy: boolean;
  /** Switch to another signature, guarding unsaved edits first. */
  selectSig: (row: SignatureRow) => Promise<void>;
  pinPath: (field: RuleField, path: string) => void;
  removePath: (field: RuleField, path: string) => void;
  save: () => Promise<void>;
  remove: () => Promise<void>;
};

export function useRulesetSession({
  notify,
  onSaved,
  confirmDiscard = (message: string) => window.confirm(message),
}: {
  notify: (message: string, kind: "success" | "error" | "info") => void;
  /** Refresh the signature list after a save or delete changes it. */
  onSaved?: () => void;
  confirmDiscard?: (message: string) => boolean;
}): RulesetSession {
  const [selected, setSelected] = useState<SignatureRow | null>(null);
  const [fields, setFields] = useState<RuleFields>({});
  const [graph, setGraph] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  // The last state the server agreed with. Every transition that makes the
  // server agree again must come back through `commit`.
  const baseline = useRef<RuleFields>({});
  const [baselineVersion, setBaselineVersion] = useState(0);

  const commit = useCallback((next: RuleFields) => {
    baseline.current = next;
    setBaselineVersion((v) => v + 1);
  }, []);

  const isDirty = useMemo(
    () => JSON.stringify(fields) !== JSON.stringify(baseline.current),
    // baselineVersion is the dependency that makes a commit re-evaluate this;
    // baseline.current is a ref and cannot be one.
    [fields, baselineVersion],
  );

  const selectSig = useCallback(
    async (row: SignatureRow) => {
      if (
        isDirty &&
        !confirmDiscard("You have unsaved changes. Discard and switch signature?")
      ) {
        return;
      }
      setSelected(row);
      setGraph(null);
      try {
        const [rs, wf] = await Promise.all([
          fetchRuleset(row.workflow_sig),
          fetchWorkflow(row.sample_image_id),
        ]);
        const loaded = rs.fields || {};
        commit(loaded);
        setFields(loaded);
        // Root the tree at the raw doc so pinned paths read `prompt.<node>...`,
        // matching the backend's resolve_path.
        const g: Record<string, unknown> = {};
        if (wf && (wf as { prompt?: unknown }).prompt != null)
          g.prompt = (wf as { prompt?: unknown }).prompt;
        if (wf && (wf as { workflow?: unknown }).workflow != null)
          g.workflow = (wf as { workflow?: unknown }).workflow;
        setGraph(g);
      } catch (e) {
        notify(`Failed to load ruleset: ${String(e)}`, "error");
      }
    },
    [isDirty, confirmDiscard, commit, notify],
  );

  const pinPath = useCallback((field: RuleField, path: string) => {
    setFields((f) => {
      const cur = f[field] || [];
      if (cur.includes(path)) return f;
      return { ...f, [field]: [...cur, path] };
    });
  }, []);

  const removePath = useCallback((field: RuleField, path: string) => {
    setFields((f) => ({
      ...f,
      [field]: (f[field] || []).filter((p) => p !== path),
    }));
  }, []);

  const save = useCallback(async () => {
    if (!selected) return;
    setBusy(true);
    try {
      await saveRuleset(selected.workflow_sig, fields);
      commit(fields);
      notify("Ruleset saved · reprojecting this signature", "success");
      onSaved?.();
    } catch (e) {
      notify(`Save failed: ${String(e)}`, "error");
    } finally {
      setBusy(false);
    }
  }, [selected, fields, commit, notify, onSaved]);

  const remove = useCallback(async () => {
    if (!selected) return;
    if (!confirmDiscard("Delete this ruleset and reproject with built-in rules?"))
      return;
    setBusy(true);
    try {
      await deleteRuleset(selected.workflow_sig);
      commit({});
      setFields({});
      notify("Ruleset deleted", "info");
      onSaved?.();
    } catch (e) {
      notify(`Delete failed: ${String(e)}`, "error");
    } finally {
      setBusy(false);
    }
  }, [selected, confirmDiscard, commit, notify, onSaved]);

  return {
    selected,
    fields,
    graph,
    isDirty,
    busy,
    selectSig,
    pinPath,
    removePath,
    save,
    remove,
  };
}
