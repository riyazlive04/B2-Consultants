"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Globe, Plus } from "lucide-react";
import { Btn } from "@/components/ui/controls";
import { Card, EmptyState, Pill } from "@/components/ui/kit";
import { toast } from "@/components/ui/feedback";
import { createSite } from "@/server/sites-actions";
import type { SiteListRow } from "@/server/sites-metrics";

export default function SitesList({
  sites,
  canManage,
}: {
  sites: SiteListRow[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function add() {
    if (!name.trim() || busy) return;
    setBusy(true);
    const fd = new FormData();
    fd.set("name", name.trim());
    const res = await createSite(fd);
    setBusy(false);
    if (!res.ok) return toast(res.error, "error");
    toast("Website created");
    setName("");
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {sites.length === 0 ? (
        <EmptyState
          icon={<Globe size={20} />}
          title="No website yet"
          body="A website holds your public pages, the shared header and footer, and the brand theme they all use."
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {sites.map((s) => (
            <Link key={s.id} href={`/sites/${s.id}`} className="block">
              <Card className="h-full transition-colors hover:border-primary">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-display text-h2 font-semibold text-ink" title={s.name}>{s.name}</p>
                    <p className="mt-0.5 truncate font-mono text-caption text-ink-3">
                      {/* The domain is the real address once DNS cuts over; until then the site
                          lives under /s/<slug>, and showing that is how anyone finds it. */}
                      {s.domain ?? `/s/${s.slug}`}
                    </p>
                  </div>
                  <Pill tone={s.published ? "good" : "neutral"}>
                    {s.published ? "Live" : "Draft"}
                  </Pill>
                </div>
                <p className="mt-3 text-sm text-ink-3">
                  {s.pageCount} {s.pageCount === 1 ? "page" : "pages"}
                </p>
              </Card>
            </Link>
          ))}
        </div>
      )}

      {canManage && (
        <Card title="New website">
          <div className="flex flex-wrap gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && add()}
              placeholder="Website name"
              className="h-9 min-w-0 flex-1 rounded-field border border-line bg-surface px-3 text-sm outline-none focus:border-primary"
            />
            <Btn icon={<Plus size={14} />} onClick={add} disabled={busy || !name.trim()}>
              Create
            </Btn>
          </div>
        </Card>
      )}
    </div>
  );
}
