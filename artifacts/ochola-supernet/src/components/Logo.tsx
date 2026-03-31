import React from "react";

interface LogoProps {
  size?: "xs" | "sm" | "md" | "lg";
  iconOnly?: boolean;
}

const heights: Record<string, number> = { xs: 28, sm: 36, md: 48, lg: 64 };

export function Logo({ size = "md", iconOnly = false }: LogoProps) {
  const h = heights[size];

  return (
    <div style={{
      width: h,
      height: h,
      borderRadius: "50%",
      overflow: "hidden",
      flexShrink: 0,
      background: "#fff",
      boxShadow: "0 0 0 2px rgba(255,255,255,0.15)",
    }}>
      <img
        src="/logo.jpg"
        alt="OcholaSupernet"
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          objectPosition: "center top",
          display: "block",
        }}
      />
    </div>
  );
}
