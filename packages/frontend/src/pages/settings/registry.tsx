import type { LucideIcon } from "lucide-react";
import { Cpu, Tags, FileText, ListTodo } from "lucide-react";
import { ModelSection } from "./sections/ModelSection";
import { TaggingSection } from "./sections/TaggingSection";
import { PromptTagsSection } from "./sections/PromptTagsSection";
import { JobsSection } from "./sections/JobsSection";

/**
 * One settings page section: a left-nav entry + the panel it renders.
 *
 * To add a new settings section: write a `*Section` component, then append one
 * entry to a group's `items` below. The nav, routing (`?section=<id>`), and
 * active highlight all derive from this registry — no other file needs editing.
 */
export type SettingsSection = {
  /** URL slug (`?section=<id>`) and stable key. */
  id: string;
  label: string;
  icon: LucideIcon;
  /** Subtitle shown in the panel header. */
  description?: string;
  /** Rendered in the right-hand content panel when active. */
  Component: () => React.ReactNode;
};

export type SettingsGroup = {
  /** Optional uppercase heading above the group; omit for an ungrouped block. */
  title?: string;
  items: SettingsSection[];
};

export const SETTINGS_GROUPS: SettingsGroup[] = [
  {
    title: "AI Tagging",
    items: [
      {
        id: "model",
        label: "Model",
        icon: Cpu,
        description: "Load, unload, and download the wd-tagger ONNX model.",
        Component: ModelSection,
      },
      {
        id: "tagging",
        label: "Tagging",
        icon: Tags,
        description: "How tags are scored and how many are kept per image.",
        Component: TaggingSection,
      },
      {
        id: "prompt-tags",
        label: "Prompt Tags",
        icon: FileText,
        description:
          "Extract prompt: tags from embedded generation metadata (A1111 / ComfyUI). Separate from AI tagging.",
        Component: PromptTagsSection,
      },
      {
        id: "jobs",
        label: "Jobs",
        icon: ListTodo,
        description: "Run AI tagging in bulk and track recent jobs.",
        Component: JobsSection,
      },
    ],
  },
];

/** Flattened section list, in nav order. */
export const SETTINGS_SECTIONS: SettingsSection[] = SETTINGS_GROUPS.flatMap(
  (g) => g.items
);
