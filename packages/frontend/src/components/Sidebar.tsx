import React from "react";

export function Sidebar({
  current,
  onNavigate,
}: {
  current: string;
  onNavigate: (path: string) => void;
}) {
  const items = [
    { key: "home", label: "All Images", path: "/", icon: "🏠" },
    { key: "libraries", label: "Libraries", path: "/libraries", icon: "📚" },
    { key: "tags", label: "Tags", path: "/tags", icon: "🏷️" },
    { key: "settings", label: "Settings", path: "/settings", icon: "⚙️" },
  ];
  return (
    <aside className="h-dvh w-16 border-r border-neutral-800 bg-neutral-950 text-neutral-300 flex flex-col">
      <div className="flex-1 py-3 flex flex-col items-center gap-3">
        {items.map((it) => (
          <button
            key={it.key}
            onClick={() => onNavigate(it.path)}
            className={`w-10 h-10 rounded flex items-center justify-center ${
              current === it.path
                ? "bg-neutral-800 text-white"
                : "hover:bg-neutral-800"
            }`}
            title={it.label}
          >
            <span aria-hidden>{it.icon}</span>
          </button>
        ))}
      </div>
    </aside>
  );
}
