import React from "react";

interface LogoProps {
  size?: "xs" | "sm" | "md" | "lg";
  /** Show just the icon, no text */
  iconOnly?: boolean;
}

/**
 * OcholaSupernet Billing — brand logo
 * Sizes: xs (sidebar collapsed), sm (sidebar), md (navbar), lg (login/hero)
 */
export function Logo({ size = "md", iconOnly = false }: LogoProps) {
  const dim = { xs: 28, sm: 32, md: 40, lg: 56 }[size];
  const nameSize = { xs: 11, sm: 13, md: 15, lg: 21 }[size];
  const tagSize = { xs: 7, sm: 7.5, md: 8.5, lg: 10.5 }[size];
  const gap = { xs: 6, sm: 7, md: 10, lg: 14 }[size];

  return (
    <div style={{ display: "flex", alignItems: "center", gap }}>
      {/* ── Icon ──────────────────────────────────────────── */}
      <svg
        width={dim}
        height={dim}
        viewBox="0 0 48 48"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{ flexShrink: 0 }}
      >
        <defs>
          <linearGradient id="osGradMain" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#22d3ee" />
            <stop offset="55%" stopColor="#0ea5e9" />
            <stop offset="100%" stopColor="#6366f1" />
          </linearGradient>
          <linearGradient id="osGradRing" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#67e8f9" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#818cf8" stopOpacity="0.2" />
          </linearGradient>
          <filter id="osGlow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="2.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Outer glow ring */}
        <circle cx="24" cy="24" r="23" stroke="url(#osGradRing)" strokeWidth="1.2" />

        {/* Main filled circle */}
        <circle cx="24" cy="24" r="20" fill="url(#osGradMain)" filter="url(#osGlow)" />

        {/* ── Network topology inside ── */}
        {/* Center hub */}
        <circle cx="24" cy="24" r="4" fill="white" opacity="0.95" />

        {/* Satellite nodes */}
        <circle cx="24" cy="11" r="2.5" fill="white" opacity="0.85" />
        <circle cx="35.4" cy="17.5" r="2.2" fill="white" opacity="0.7" />
        <circle cx="35.4" cy="30.5" r="2.2" fill="white" opacity="0.7" />
        <circle cx="24" cy="37" r="2.5" fill="white" opacity="0.85" />
        <circle cx="12.6" cy="30.5" r="2.2" fill="white" opacity="0.7" />
        <circle cx="12.6" cy="17.5" r="2.2" fill="white" opacity="0.7" />

        {/* Spoke connections */}
        <line x1="24" y1="20" x2="24" y2="13.5" stroke="white" strokeWidth="1.4" opacity="0.55" />
        <line x1="27.5" y1="21.5" x2="33.6" y2="18.8" stroke="white" strokeWidth="1.4" opacity="0.45" />
        <line x1="27.5" y1="26.5" x2="33.6" y2="29.2" stroke="white" strokeWidth="1.4" opacity="0.45" />
        <line x1="24" y1="28" x2="24" y2="34.5" stroke="white" strokeWidth="1.4" opacity="0.55" />
        <line x1="20.5" y1="26.5" x2="14.4" y2="29.2" stroke="white" strokeWidth="1.4" opacity="0.45" />
        <line x1="20.5" y1="21.5" x2="14.4" y2="18.8" stroke="white" strokeWidth="1.4" opacity="0.45" />

        {/* Outer ring arcs (partial) */}
        <circle cx="24" cy="24" r="13" stroke="white" strokeWidth="0.8" strokeDasharray="3 4" opacity="0.25" />
      </svg>

      {/* ── Text ──────────────────────────────────────────── */}
      {!iconOnly && (
        <div style={{ display: "flex", flexDirection: "column", lineHeight: 1, gap: 2 }}>
          <span
            style={{
              fontSize: nameSize,
              fontWeight: 900,
              color: "white",
              letterSpacing: "-0.01em",
              whiteSpace: "nowrap",
            }}
          >
            OcholaSupernet
          </span>
          <span
            style={{
              fontSize: tagSize,
              fontWeight: 700,
              color: "#22d3ee",
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              whiteSpace: "nowrap",
              display: "flex",
              alignItems: "center",
              gap: 3,
            }}
          >
            <span
              style={{
                display: "inline-block",
                width: tagSize * 0.55,
                height: tagSize * 0.55,
                borderRadius: "50%",
                background: "#22d3ee",
                flexShrink: 0,
              }}
            />
            Billing
          </span>
        </div>
      )}
    </div>
  );
}
