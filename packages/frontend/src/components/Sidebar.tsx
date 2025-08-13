import React from "react";
import { Home, FolderOpen, Tags as TagsIcon, Settings } from "lucide-react";

export function Sidebar({
  current,
  onNavigate,
}: {
  current: string;
  onNavigate: (path: string) => void;
}) {
  const items = [
    { key: "home", label: "All Images", path: "/", icon: Home },
    {
      key: "libraries",
      label: "Libraries",
      path: "/libraries",
      icon: FolderOpen,
    },
    { key: "tags", label: "Tags", path: "/tags", icon: TagsIcon },
    { key: "settings", label: "Settings", path: "/settings", icon: Settings },
  ];
  return (
    <aside className="h-dvh w-16 border-r border-neutral-800 bg-neutral-950 text-neutral-300 flex flex-col">
      <div className="flex-1 py-3 flex flex-col items-center gap-3">
        {items.map((it) => {
          const Icon = it.icon;
          const active = current === it.path;
          return (
            <button
              key={it.key}
              onClick={() => onNavigate(it.path)}
              className={`relative w-10 h-10 rounded flex items-center justify-center ${
                active ? "bg-neutral-800 text-white" : "hover:bg-neutral-800"
              }`}
              title={it.label}
              aria-current={active ? "page" : undefined}
            >
              {active && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 h-6 w-0.5 bg-purple-500 rounded" />
              )}
              <Icon size={18} />
            </button>
          );
        })}
      </div>
    </aside>
  );
}
