interface LogoProps {
  size?: "xs" | "sm" | "md" | "lg";
  iconOnly?: boolean;
}

const sizes = {
  xs: { width: 34, height: 28 },
  sm: { width: 116, height: 52 },
  md: { width: 146, height: 64 },
  lg: { width: 184, height: 80 },
};

export function Logo({ size = "md", iconOnly = false }: LogoProps) {
  const s = sizes[size];

  return (
    <div style={{ display: "inline-flex", alignItems: "center", flexShrink: 0 }}>
      <img
        src={iconOnly ? "/ocholasupernet-mark.png" : "/ocholasupernet-logo.png"}
        alt="OcholaSuperNet"
        style={{
          width: iconOnly ? s.height : s.width,
          height: s.height,
          objectFit: "contain",
          display: "block",
        }}
      />
    </div>
  );
}
