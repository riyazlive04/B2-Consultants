import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

/**
 * Nested-route breadcrumb trail (BUILD_CHECKLIST §2 — `/contacts/[id]`,
 * `/automation/[id]`, and future detail routes). Server-renderable: plain `<Link>`s,
 * no client state. The last item is never a link — it's "you are here".
 */
export type BreadcrumbItem = { label: string; href?: string };

export function Breadcrumbs({ items }: { items: BreadcrumbItem[] }): ReactNode {
  if (items.length === 0) return null;
  return (
    <nav aria-label="Breadcrumb" className="mb-3">
      <ol className="flex flex-wrap items-center gap-1.5 text-sm text-muted">
        {items.map((item, i) => {
          const isLast = i === items.length - 1;
          return (
            <li key={`${item.label}-${i}`} className="flex items-center gap-1.5 min-w-0">
              {i > 0 && <ChevronRight size={14} className="flex-none text-ink-3" aria-hidden />}
              {item.href && !isLast ? (
                <Link href={item.href} className="truncate transition-colors hover:text-ink hover:underline">
                  {item.label}
                </Link>
              ) : (
                <span
                  className={`truncate ${isLast ? "font-medium text-ink" : ""}`}
                  aria-current={isLast ? "page" : undefined}
                >
                  {item.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
