import { useQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { PageHeader } from "../components/ui/PageHeader";
import { Card } from "../components/ui/Card";
import { fetchAiCoverage, isStatusBusy } from "../lib/ai";
import { SettingsProvider, useSettings } from "./settings/SettingsContext";
import { ModelSection } from "./settings/sections/ModelSection";
import { JobsSection } from "./settings/sections/JobsSection";

type Library = { _id: string; name?: string; path?: string };

async function api<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

function pct(part: number, whole: number) {
  if (!whole) return 0;
  return Math.min(100, Math.round((part / whole) * 100));
}

/** A thin AI-coverage bar shared by the global stat and per-library rows. */
function CoverageBar({ tagged, total }: { tagged: number; total: number }) {
  return (
    <progress
      className="w-full h-2 [&::-webkit-progress-bar]:bg-neutral-800 [&::-webkit-progress-value]:bg-purple-600 [&::-moz-progress-bar]:bg-purple-600"
      value={pct(tagged, total)}
      max={100}
    />
  );
}

/**
 * AI-tag coverage overview. Counts come from `/api/ai/coverage` (the
 * `has_ai_tags` flag); library names are joined from `/api/libraries`.
 * Polls faster while the AI subsystem is busy so the numbers track a running
 * job, idle otherwise.
 */
function CoveragePanel() {
  const { status } = useSettings();
  const busy = isStatusBusy(status);

  const { data: cov } = useQuery({
    queryKey: ["aiCoverage"],
    queryFn: ({ signal }) => fetchAiCoverage(signal),
    refetchInterval: busy ? 3000 : 15000,
  });
  const { data: libs } = useQuery({
    queryKey: ["libraries"],
    queryFn: () => api<Library[]>("/api/libraries"),
    staleTime: 60_000,
  });

  const nameOf = (id: string) =>
    libs?.find((l) => l._id === id)?.name || id;

  return (
    <Card className="p-5 space-y-4">
      <div className="font-semibold">Coverage</div>

      {cov ? (
        <>
          <div className="space-y-2">
            <div className="flex items-end justify-between">
              <div className="text-3xl font-bold tabular-nums text-neutral-100">
                {cov.ai_tagged.toLocaleString()}
                <span className="text-lg font-medium text-neutral-500">
                  {" "}
                  / {cov.total.toLocaleString()}
                </span>
              </div>
              <div className="text-sm text-neutral-400">
                {pct(cov.ai_tagged, cov.total)}% AI-tagged
                <span className="text-neutral-600">
                  {" "}
                  · {cov.untagged.toLocaleString()} untagged
                </span>
              </div>
            </div>
            <CoverageBar tagged={cov.ai_tagged} total={cov.total} />
          </div>

          {cov.per_library.length > 1 && (
            <div className="space-y-3 pt-1">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                By library
              </div>
              {cov.per_library.map((l) => (
                <div key={l.library_id} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="truncate text-neutral-300">
                      {nameOf(l.library_id)}
                    </span>
                    <span className="text-neutral-500 tabular-nums">
                      {l.ai_tagged.toLocaleString()} /{" "}
                      {l.total.toLocaleString()} ·{" "}
                      {pct(l.ai_tagged, l.total)}%
                    </span>
                  </div>
                  <CoverageBar tagged={l.ai_tagged} total={l.total} />
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="text-sm text-neutral-500">Loading coverage…</div>
      )}
    </Card>
  );
}

export default function AITaggingPage() {
  return (
    <SettingsProvider>
      <div className="p-6 space-y-6">
        <PageHeader
          icon={Sparkles}
          title="AI Tagging"
          description="Tag your library with the wd-tagger model and track progress."
        />

        <CoveragePanel />

        <section className="space-y-2">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
            Model
          </div>
          <ModelSection />
        </section>

        <JobsSection />
      </div>
    </SettingsProvider>
  );
}
