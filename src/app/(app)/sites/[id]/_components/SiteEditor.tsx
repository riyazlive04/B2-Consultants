"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ExternalLink, Globe, Plus, Trash2 } from "lucide-react";
import { Btn, IconButton } from "@/components/ui/controls";
import { Card, Pill, Hint } from "@/components/ui/kit";
import { toast, askConfirm } from "@/components/ui/feedback";
import type { SiteDetail } from "@/server/sites-metrics";
import type { NavItem } from "@/lib/site-types";
import {
  createPage,
  deletePage,
  setSiteDomain,
  togglePublishSite,
  updateSiteSettings,
} from "@/server/sites-actions";

const input =
  "h-9 w-full rounded-field border border-line bg-surface px-3 text-sm outline-none focus:border-primary";

export default function SiteEditor({ site, canManage }: { site: SiteDetail; canManage: boolean }) {
  const router = useRouter();
  const [tab, setTab] = useState<"pages" | "nav" | "brand" | "domain">("pages");

  const [newTitle, setNewTitle] = useState("");
  const [newPath, setNewPath] = useState("");
  const [nav, setNav] = useState<NavItem[]>(site.nav);
  const [theme, setTheme] = useState(site.theme);
  const [domain, setDomain] = useState(site.domain ?? "");
  const [pixel, setPixel] = useState(site.metaPixelId ?? "");
  const [ga, setGa] = useState(site.gaMeasurementId ?? "");
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) {
    if (busy) return;
    setBusy(true);
    const res = await fn();
    setBusy(false);
    if (!res.ok) return toast(res.error ?? "Something went wrong", "error");
    toast(ok);
    router.refresh();
  }

  const TABS = [
    ["pages", "Pages"],
    ["nav", "Menu"],
    ["brand", "Brand"],
    ["domain", "Domain & tracking"],
  ] as const;

  return (
    <div className="w-full space-y-5">
      <Link href="/sites" className="inline-flex items-center gap-1.5 text-sm text-ink-2 hover:text-primary">
        <ArrowLeft size={16} /> Website
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-display-l font-bold text-ink">{site.name}</h1>
          <p className="mt-0.5 font-mono text-caption text-ink-3">
            {site.domain ?? `/s/${site.slug}`} · {site.published ? "live" : "draft"}
          </p>
        </div>
        {canManage && (
          <Btn
            variant={site.published ? "soft" : "primary"}
            icon={<Globe size={16} />}
            busy={busy}
            onClick={() => run(() => togglePublishSite(site.id), site.published ? "Unpublished" : "Published")}
          >
            {site.published ? "Unpublish" : "Publish"}
          </Btn>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {TABS.map(([key, label]) => (
          <Btn key={key} size="sm" variant={tab === key ? "primary" : "ghost"} onClick={() => setTab(key)}>
            {label}
          </Btn>
        ))}
      </div>

      {tab === "pages" && (
        <Card title="Pages">
          <div className="space-y-1.5">
            {site.pages.length === 0 && <p className="text-sm text-ink-3">No pages yet.</p>}
            {site.pages.map((p) => (
              <div key={p.id} className="flex items-center gap-2 rounded-field px-2 py-2 hover:bg-surface-2">
                <Link href={`/sites/${site.id}/pages/${p.id}`} className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">{p.title}</span>
                  <span className="block truncate font-mono text-caption text-ink-3">
                    {p.path} · {p.sectionCount} {p.sectionCount === 1 ? "section" : "sections"}
                  </span>
                </Link>
                <Pill tone={p.published ? "good" : "neutral"}>{p.published ? "Live" : "Draft"}</Pill>
                {site.published && p.published && (
                  <a
                    href={`/s/${site.slug}${p.path === "/" ? "" : p.path}`}
                    target="_blank"
                    rel="noreferrer"
                    title="Open the live page"
                  >
                    <IconButton label="Open live"><ExternalLink size={13} /></IconButton>
                  </a>
                )}
                {canManage && (
                  <IconButton
                    label="Delete page"
                    onClick={async () => {
                      if (!(await askConfirm({ title: `Delete "${p.title}"?`, danger: true }))) return;
                      run(() => deletePage(p.id), "Page deleted");
                    }}
                  >
                    <Trash2 size={13} />
                  </IconButton>
                )}
              </div>
            ))}
          </div>

          {canManage && (
            <div className="mt-4 flex flex-wrap gap-1.5">
              <input
                className={`${input} sm:w-48`}
                placeholder="Page title"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
              />
              <input
                className={`${input} sm:w-48`}
                placeholder="/path"
                value={newPath}
                onChange={(e) => setNewPath(e.target.value)}
              />
              <Btn
                size="sm"
                icon={<Plus size={14} />}
                disabled={!newTitle.trim()}
                busy={busy}
                onClick={() =>
                  run(async () => {
                    const res = await createPage(site.id, newTitle, newPath || newTitle);
                    if (res.ok) {
                      setNewTitle("");
                      setNewPath("");
                    }
                    return res;
                  }, "Page added")
                }
              >
                Add page
              </Btn>
              <Hint>
                The path is reproduced exactly - enter <span className="font-mono">/aboutus</span>, not
                “About Us”, if that is the live URL you are matching.
              </Hint>
            </div>
          )}
        </Card>
      )}

      {tab === "nav" && (
        <Card
          title="Menu"
          subtitle="Shown by any header section carrying a Menu block - edited once, applied to every page"
        >
          <div className="space-y-2">
            {nav.map((item, i) => (
              <div key={i} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1.5fr_auto_auto]">
                <input
                  className={input}
                  placeholder="Label"
                  value={item.label}
                  onChange={(e) =>
                    setNav(nav.map((n, j) => (j === i ? { ...n, label: e.target.value } : n)))
                  }
                />
                <input
                  className={input}
                  placeholder="/path or https://…"
                  value={item.href}
                  onChange={(e) => setNav(nav.map((n, j) => (j === i ? { ...n, href: e.target.value } : n)))}
                />
                <label className="flex items-center gap-1.5 text-caption text-ink-2" title="Carry utm/click ids onto the target">
                  <input
                    type="checkbox"
                    checked={item.forwardParams ?? false}
                    onChange={(e) =>
                      setNav(nav.map((n, j) => (j === i ? { ...n, forwardParams: e.target.checked } : n)))
                    }
                  />
                  Track
                </label>
                <IconButton label="Remove" onClick={() => setNav(nav.filter((_, j) => j !== i))}>
                  <Trash2 size={13} />
                </IconButton>
              </div>
            ))}
          </div>
          <Hint>
            Tick <b>Track</b> on any link leaving this site - it carries the visitor&apos;s utm and click
            ids across. Without it, an opt-in on the funnel cannot be traced to the page that sent it.
          </Hint>
          {canManage && (
            <div className="mt-3 flex gap-1.5">
              <Btn size="sm" variant="ghost" icon={<Plus size={13} />} onClick={() => setNav([...nav, { label: "", href: "" }])}>
                Add link
              </Btn>
              <Btn size="sm" busy={busy} onClick={() => run(() => updateSiteSettings(site.id, { navMenu: nav }), "Menu saved")}>
                Save menu
              </Btn>
            </div>
          )}
        </Card>
      )}

      {tab === "brand" && (
        <Card title="Brand" subtitle="Colours and type for every page on this site">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {([
              ["primary", "Brand colour"],
              ["onPrimary", "Text on brand colour"],
              ["background", "Page background"],
              ["text", "Body text"],
              ["textMuted", "Muted text"],
            ] as const).map(([key, label]) => (
              <label key={key} className="text-caption font-semibold uppercase text-ink-3">
                {label}
                <div className="mt-1 flex gap-1.5">
                  <input
                    type="color"
                    className="h-9 w-12 rounded-field border border-line bg-surface"
                    value={theme[key]}
                    onChange={(e) => setTheme({ ...theme, [key]: e.target.value })}
                  />
                  <input
                    className={input}
                    value={theme[key]}
                    onChange={(e) => setTheme({ ...theme, [key]: e.target.value })}
                  />
                </div>
              </label>
            ))}
            <label className="text-caption font-semibold uppercase text-ink-3">
              Content width (px)
              <input
                type="number"
                className={input}
                value={theme.contentWidth}
                onChange={(e) => setTheme({ ...theme, contentWidth: Number(e.target.value) || 1140 })}
              />
            </label>
          </div>
          {canManage && (
            <div className="mt-3">
              <Btn size="sm" busy={busy} onClick={() => run(() => updateSiteSettings(site.id, { theme }), "Brand saved")}>
                Save brand
              </Btn>
            </div>
          )}
        </Card>
      )}

      {tab === "domain" && (
        <div className="space-y-4">
          <Card title="Domain" subtitle="Leave blank until DNS points here">
            <input
              className={input}
              placeholder="b2consultants.de"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
            />
            <Hint>
              Attaching a domain does not move it - DNS and the reverse proxy do that. Set this only
              once the hostname actually resolves here, or the site will answer on an address nobody
              reaches.
            </Hint>
            {canManage && (
              <div className="mt-3">
                <Btn size="sm" busy={busy} onClick={() => run(() => setSiteDomain(site.id, domain || null), "Domain updated")}>
                  Save domain
                </Btn>
              </div>
            )}
          </Card>

          <Card title="Tracking" subtitle="Injected on every published page of this site">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="text-caption font-semibold uppercase text-ink-3">
                Meta Pixel ID
                <input className={input} value={pixel} onChange={(e) => setPixel(e.target.value)} placeholder="1234567890" />
              </label>
              <label className="text-caption font-semibold uppercase text-ink-3">
                GA measurement ID
                <input className={input} value={ga} onChange={(e) => setGa(e.target.value)} placeholder="G-XXXXXXX" />
              </label>
            </div>
            {canManage && (
              <div className="mt-3">
                <Btn
                  size="sm"
                  busy={busy}
                  onClick={() => run(() => updateSiteSettings(site.id, { metaPixelId: pixel, gaMeasurementId: ga }), "Tracking saved")}
                >
                  Save tracking
                </Btn>
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
