import React from "react";

interface LogoProps {
  size?: "xs" | "sm" | "md" | "lg";
  iconOnly?: boolean;
}

const heights: Record<string, number> = { xs: 28, sm: 36, md: 48, lg: 64 };

export function Logo({ size = "md", iconOnly = false }: LogoProps) {
  const h = heights[size];

  if (iconOnly) {
    /* Show only the globe portion — clip to roughly the top 65% of the image */
    return (
      <div style={{
        width: h,
        height: h,
        borderRadius: h * 0.22,
        overflow: "hidden",
        flexShrink: 0,
        background: "#fff",
      }}>
        <img
          src="/logo.jpg"
          alt="OcholaSupernet"
          style={{
            width: "auto",
            height: h * 1.6,
            marginTop: -(h * 0.05),
            marginLeft: "50%",
            transform: "translateX(-50%)",
            display: "block",
          }}
        />
      </div>
    );
  }

  return (
    <img
      src="/logo.jpg"
      alt="OcholaSupernet"
      style={{
        height: h,
        width: "auto",
        display: "block",
        objectFit: "contain",
        flexShrink: 0,
        borderRadius: 4,
      }}
    />
  );
}
