import { AlertTriangle, Laptop, Smartphone, Tablet } from "lucide-react";
import { deviceKind, deviceRows, userAgentMismatch, type StoredDevice } from "@/lib/device";

/**
 * What we know about the machine a signature was made on.
 *
 * The panel keeps the same split the certificate prints, because collapsing it would be the whole
 * problem: the top rows are the browser's own account of itself and can be edited by anyone with
 * devtools, while the IP and the request headers were observed by our server and cannot.
 */
export function DevicePanel({
  title,
  device,
  signedAt,
}: {
  title: string;
  device: StoredDevice | null;
  signedAt: Date | null;
}) {
  if (!device) {
    return (
      <div className="rounded-card border border-line bg-surface p-5 shadow-card">
        <h2 className="font-display text-h3 text-ink">{title}</h2>
        <p className="mt-2 text-caption text-faint">
          {signedAt
            ? "This signature predates device capture, or the browser withheld its details."
            : "Recorded when the agreement is signed."}
        </p>
      </div>
    );
  }

  const kind = deviceKind(device.reported);
  const Icon = kind === "Phone" ? Smartphone : kind === "Tablet" ? Tablet : Laptop;
  const mismatch = userAgentMismatch(device);

  return (
    <div className="rounded-card border border-line bg-surface p-5 shadow-card">
      <div className="flex items-center gap-2">
        <Icon size={17} className="text-primary" />
        <h2 className="font-display text-h3 text-ink">{title}</h2>
      </div>

      <dl className="mt-3 space-y-1.5">
        {deviceRows(device).map(([label, value]) => (
          <div key={label} className="flex gap-3 text-body">
            <dt className="w-32 flex-none text-ink-2">{label}</dt>
            <dd className="min-w-0 flex-1 text-ink">{value}</dd>
          </div>
        ))}
      </dl>

      <p className="mt-3 break-all font-mono text-caption text-faint">
        {device.reported.userAgent || "no user agent reported"}
      </p>

      <p className="mt-3 text-caption text-faint">
        Everything above the IP address is <strong>reported by the signer&rsquo;s browser</strong> and could be
        altered by them. The IP address and request headers were observed by this server.
      </p>

      {mismatch && (
        <p className="mt-3 flex gap-2 rounded-field bg-warn-soft px-3 py-2 text-caption text-warn">
          <AlertTriangle size={14} className="mt-0.5 flex-none" />
          <span>
            The browser reported a different user agent from the one on the request our server received. Noted
            for completeness; it does not by itself invalidate the signature.
          </span>
        </p>
      )}
    </div>
  );
}
