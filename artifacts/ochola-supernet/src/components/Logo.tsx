import React from "react";

interface LogoProps {
  size?: "xs" | "sm" | "md" | "lg";
  iconOnly?: boolean;
}

export function Logo({ size = "md", iconOnly = false }: LogoProps) {
  const dim =      { xs: 22, sm: 26, md: 32, lg: 44 }[size];
  const radius =   { xs: 5,  sm: 6,  md: 8,  lg: 11 }[size];
  const nameSize = { xs: 11, sm: 13, md: 15, lg: 22 }[size];
  const tagSize =  { xs: 6.5,sm: 7,  md: 8,  lg: 10 }[size];
  const gap =      { xs: 6,  sm: 8,  md: 10, lg: 13 }[size];
  const dotSize =  tagSize * 0.6;

  return (
    <div style={{ display: "flex", alignItems: "center", gap, userSelect: "none" }}>

      {/* ── Square icon ──────────────────────────────────── */}
      <div
        style={{
          width: dim,
          height: dim,
          borderRadius: radius,
          background: "linear-gradient(135deg, #f97316 0%, #ef4444 100%)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          boxShadow: "0 2px 10px rgba(249,115,22,0.35)",
        }}
      >
        {/* Letter O monogram */}
        <svg
          width={dim * 0.56}
          height={dim * 0.56}
          viewBox="0 0 18 18"
          fill="none"
        >
          <circle
            cx="9"
            cy="9"
            r="6.5"
            stroke="white"
            strokeWidth="2.4"
            fill="none"
            opacity="0.95"
          />
          <circle cx="9" cy="9" r="2.2" fill="white" opacity="0.75" />
        </svg>
      </div>

      {/* ── Text ─────────────────────────────────────────── */}
      {!iconOnly && (
        <div style={{ display: "flex", flexDirection: "column", lineHeight: 1, gap: 3 }}>
          <span
            style={{
              fontSize: nameSize,
              fontWeight: 800,
              color: "white",
              letterSpacing: "-0.02em",
              whiteSpace: "nowrap",
            }}
          >
            OcholaSupernet
          </span>
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              fontSize: tagSize,
              fontWeight: 700,
              color: "#f97316",
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              whiteSpace: "nowrap",
            }}
          >
            <span
              style={{
                width: dotSize,
                height: dotSize,
                borderRadius: "50%",
                background: "#f97316",
                flexShrink: 0,
                display: "inline-block",
              }}
            />
            Billing
          </span>
        </div>
      )}
    </div>
  );
}
