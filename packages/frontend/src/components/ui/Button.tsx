import React from "react";
import { cn } from "../../lib/cn";

type Variant =
  | "primary"
  | "secondary"
  | "success"
  | "danger"
  | "dangerSoft"
  | "ghost";
type Size = "sm" | "md" | "icon";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-purple-600 hover:bg-purple-500 text-white border border-transparent",
  secondary:
    "bg-neutral-800 hover:bg-neutral-700 text-neutral-100 border border-neutral-700",
  success: "bg-emerald-600 hover:bg-emerald-500 text-white border border-transparent",
  danger: "bg-red-600 hover:bg-red-500 text-white border border-transparent",
  dangerSoft:
    "bg-red-600/20 hover:bg-red-600/30 text-red-200 border border-red-700",
  ghost: "bg-transparent hover:bg-neutral-800 text-neutral-300 border border-transparent",
};

const SIZES: Record<Size, string> = {
  sm: "px-2.5 py-1.5 text-xs gap-1.5",
  md: "px-3.5 py-2 text-sm gap-2",
  icon: "p-2",
};

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  /** Toggle/pressed state — applies the brand accent regardless of variant. */
  active?: boolean;
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    { variant = "secondary", size = "md", active, className, children, ...rest },
    ref,
  ) {
    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center rounded-lg font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none",
          SIZES[size],
          active
            ? "bg-purple-700 hover:bg-purple-600 text-white border border-purple-600"
            : VARIANTS[variant],
          className,
        )}
        {...rest}
      >
        {children}
      </button>
    );
  },
);
