import { cn } from "@/lib/utils";
import React from "react";

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: "success" | "danger" | "warning" | "info" | "default" | "violet";
}

export function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border",
        {
          "bg-green-500/10 text-green-400 border-green-500/20": variant === "success",
          "bg-red-500/10 text-red-400 border-red-500/20": variant === "danger",
          "bg-amber-500/10 text-amber-400 border-amber-500/20": variant === "warning",
          "bg-blue-500/10 text-blue-400 border-blue-500/20": variant === "info",
          "bg-slate-500/10 text-slate-300 border-slate-500/20": variant === "default",
          "bg-indigo-500/10 text-indigo-400 border-indigo-500/20": variant === "violet",
        },
        className
      )}
      {...props}
    />
  );
}
