import React from "react";
import { cn } from "@/lib/utils";

interface StatCardProps {
  label: string;
  value: string | number;
  subValue?: string;
  trend?: string;
  trendUp?: boolean;
  color?: "cyan" | "green" | "amber" | "red" | "violet" | "blue" | "indigo";
}

export function StatCard({ label, value, subValue, trend, trendUp, color = "cyan" }: StatCardProps) {
  const colorMap = {
    cyan: "from-cyan-500 to-cyan-600",
    green: "from-emerald-500 to-emerald-600",
    amber: "from-amber-500 to-amber-600",
    red: "from-rose-500 to-rose-600",
    violet: "from-violet-500 to-violet-600",
    blue: "from-blue-500 to-blue-600",
    indigo: "from-indigo-500 to-indigo-600",
  };

  return (
    <div className="bg-card border border-border rounded-2xl p-5 relative overflow-hidden group hover:border-border/80 hover:-translate-y-1 transition-all duration-300 shadow-sm hover:shadow-xl">
      <div className={cn("absolute top-0 left-0 right-0 h-1 bg-gradient-to-r", colorMap[color])} />
      
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">{label}</p>
      
      <div className="flex items-baseline gap-2">
        <h3 className="text-3xl font-extrabold text-foreground tracking-tight">{value}</h3>
        {trend && (
          <span className={cn("text-xs font-semibold px-2 py-0.5 rounded-full", trendUp ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400")}>
            {trend}
          </span>
        )}
      </div>
      
      {subValue && (
        <p className="text-sm text-muted-foreground mt-2">{subValue}</p>
      )}
    </div>
  );
}
