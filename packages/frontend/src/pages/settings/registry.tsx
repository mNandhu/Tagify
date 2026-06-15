import type { LucideIcon } from "lucide-react";
import { Tags, FileText } from "lucide-react";
import { TaggingSection } from "./sections/TaggingSection";
import { PromptTagsSection } from "./sections/PromptTagsSection";

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
    title: "Tags",
    items: [
      {
        id: "tagging",
        label: "AI Tagging",
        icon: Tags,
        description:
          "The wd-tagger model, scoring thresholds, and how many tags are kept per image. Run tagging and track jobs from the AI Tagging page.",
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
    ],
  },
];

/** Flattened section list, in nav order. */
export const SETTINGS_SECTIONS: SettingsSection[] = SETTINGS_GROUPS.flatMap(
  (g) => g.items
);
