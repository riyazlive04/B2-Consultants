import type { ReactNode } from "react";

/**
 * Legacy wrapper - the old 3D tilt effect was removed for the modern flat look.
 * Kept as a lightweight passthrough with a soft hover lift so existing call sites
 * keep working without a 3D transform.
 */
export function Tilt3D({
  children,
  className,
}: {
  children: ReactNode;
  maxTilt?: number;
  className?: string;
}) {
  return <div className={`card-hover ${className ?? ""}`}>{children}</div>;
}
