type LogoSize = "xs" | "sm" | "md" | "lg" | "xl";

const sizes: Record<LogoSize, number> = {
  xs: 18,
  sm: 28,
  md: 48,
  lg: 92,
  xl: 120
};

export function VireonLogo({
  size = "md",
  className = "",
  framed = false,
  alt = "Vireon"
}: {
  size?: LogoSize;
  className?: string;
  framed?: boolean;
  alt?: string;
}) {
  const px = sizes[size];
  // Optimized mark for UI chrome; original high-res only for large marketing surfaces.
  const src = size === "xl" ? "/logo.png" : "/logo-mark.png";
  const img = (
    <img
      src={src}
      alt={alt}
      width={px}
      height={px}
      className={`vireon-logo-img ${className}`.trim()}
      draggable={false}
      decoding="async"
    />
  );

  if (!framed) return img;

  return (
    <div className={`vireon-logo-frame vireon-logo-frame-${size}`} aria-hidden={alt === ""}>
      {img}
    </div>
  );
}
