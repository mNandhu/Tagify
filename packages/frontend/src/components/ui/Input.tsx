import React from "react";
import { cn } from "../../lib/cn";

const FIELD =
  "w-full rounded-lg bg-neutral-950/70 border border-neutral-800 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 focus:border-purple-600/60 transition-colors";

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cn(FIELD, className)} {...rest} />;
});

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(function Select({ className, ...rest }, ref) {
  return <select ref={ref} className={cn(FIELD, className)} {...rest} />;
});

/** Label + optional hint wrapper for form controls. */
export function Field({
  label,
  hint,
  htmlFor,
  className,
  children,
}: {
  label?: React.ReactNode;
  hint?: React.ReactNode;
  htmlFor?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      {label && (
        <label
          htmlFor={htmlFor}
          className="block text-xs font-medium text-neutral-400 mb-1.5"
        >
          {label}
        </label>
      )}
      {children}
      {hint && <p className="text-xs text-neutral-500 mt-1.5">{hint}</p>}
    </div>
  );
}
