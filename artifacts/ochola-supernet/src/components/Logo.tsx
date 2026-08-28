interface LogoProps {
  size?: "xs" | "sm" | "md" | "lg";
  iconOnly?: boolean;
}

const sizes = {
  xs: { mark: 28, icon: 14, text: "0.8rem", gap: 8 },
  sm: { mark: 36, icon: 18, text: "0.95rem", gap: 10 },
  md: { mark: 44, icon: 22, text: "1.1rem", gap: 11 },
  lg: { mark: 56, icon: 28, text: "1.35rem", gap: 13 },
};

export function Logo({ size = "md", iconOnly = false }: LogoProps) {
  const s = sizes[size];

  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: s.gap, flexShrink: 0 }}>
      <div
        aria-hidden="true"
        style={{
          width: s.mark,
          height: s.mark,
          borderRadius: s.mark * 0.28,
          flexShrink: 0,
          display: "grid",
          placeItems: "center",
           background: "linear-gradient(145deg, #e78a55 0%, #d96835 52%, #b95024 100%)",
           boxShadow: "0 8px 20px rgba(185, 80, 36, 0.24), inset 0 1px 0 rgba(255,255,255,0.28)",
        }}
      >
        <svg width={s.icon} height={s.icon} viewBox="0 0 24 24" fill="none">
          <path d="M4 16.5a11 11 0 0 1 16 0M7.5 13a6.3 6.3 0 0 1 9 0M11 9.7a1.45 1.45 0 0 1 2 0" stroke="white" strokeWidth="2.1" strokeLinecap="round" />
          <circle cx="12" cy="18.4" r="1.45" fill="white" />
        </svg>
      </div>
      {!iconOnly && (
        <span style={{
          fontSize: s.text,
          fontWeight: 800,
          color: "currentColor",
          letterSpacing: "-0.045em",
          lineHeight: 1,
        }}>
          ISPlatty
        </span>
      )}
    </div>
  );
}
