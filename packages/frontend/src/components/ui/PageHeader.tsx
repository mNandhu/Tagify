import React from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "../../lib/cn";

/**
 * Per-page title bar: icon + title + optional count and right-aligned actions.
 * Gives every route a consistent anchor so users always know where they are.
 */
export function PageHeader({
  icon: Icon,
  title,
  count,
  description,
  actions,
  className,
  children,
}: {
  icon?: LucideIcon;
  title: React.ReactNode;
  count?: number;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  /** Optional row rendered below the title (search, filters, tabs…). */
  children?: React.ReactNode;
}) {
  return (
    <div className={cn("mb-5", className)}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          {Icon && (
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-neutral-800/80 text-purple-300 shrink-0">
              <Icon size={18} />
            </span>
          )}
          <div className="min-w-0">
            <h2 className="text-xl font-bold tracking-tight text-neutral-100 flex items-center gap-2 truncate">
              {title}
              {typeof count === "number" && (
                <span className="text-sm font-medium text-neutral-500 tabular-nums">
                  {count.toLocaleString()}
                </span>
              )}
            </h2>
            {description && (
              <p className="text-sm text-neutral-400 truncate">{description}</p>
            )}
          </div>
        </div>
        {actions && (
          <div className="flex items-center gap-2 shrink-0">{actions}</div>
        )}
      </div>
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}
