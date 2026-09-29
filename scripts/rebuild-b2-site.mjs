/**
 * Rebuild b2consultants.de inside this app.
 *
 * Creates (or refreshes) the "b2consultants" site with its five pages, the shared header/footer,
 * the brand theme and the nav - reproducing the GHL-hosted site the app is replacing.
 *
 *   node --env-file=.env scripts/rebuild-b2-site.mjs             # dry run: prints what it would do
 *   node --env-file=.env scripts/rebuild-b2-site.mjs --apply     # write it
 *   node --env-file=.env scripts/rebuild-b2-site.mjs --apply --images   # also upload the assets
 *
 * ── Where these values come from ──────────────────────────────────────────────────────────────
 * Not from a screenshot. The copy is lifted from the live pages' own markup, and the design tokens
 * are read out of the CSS custom properties GHL generates:
 *     --color-m2ti8lx2: #4949ef     brand violet (header + "About Me" band)
 *     --headlinefont:   Montserrat
 *     --contentfont:    Raleway
 *     .inner            max-width: 1170px
 *
 * ── Images ────────────────────────────────────────────────────────────────────────────────────
 * `--images` uploads the captured originals to Supabase Storage and rewrites the blocks to point
 * at them. Without it - or without SUPABASE_SERVICE_ROLE_KEY - the blocks keep the GHL CDN URLs so
 * the pages still render, and you can swap them from the media library later. That fallback is a
 * STOPGAP: it leaves the rebuilt site depending on the platform you are leaving.
 */

import { PrismaClient } from "@prisma/client";
import { readFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const WITH_IMAGES = args.includes("--images");
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const ASSET_DIR = flag("assets", "");

const prisma = new PrismaClient();

// ── Design tokens, read from the live site ────────────────────────────────────
const VIOLET = "#4949ef";
const THEME = {
  primary: VIOLET,
  onPrimary: "#ffffff",
  background: "#ffffff",
  text: "#101828",
  textMuted: "#475467",
  headingFont: "Montserrat, sans-serif",
  bodyFont: "Raleway, sans-serif",
  radius: 8,
  contentWidth: 1170,
};

const NAV = [
  // "Training" points at the GHL opt-in funnel, which STAYS on GHL. forwardParams carries the
  // visitor's utm/click ids across the hostname boundary - without it every opt-in it produces
  // arrives unattributed.
  { label: "Training", href: "https://optin.b2consultants.de/lp", forwardParams: true },
  { label: "About Us", href: "/aboutus" },
  { label: "Career", href: "/career" },
  // Contact is a section on the homepage, not a page - that is how the live nav works too.
  { label: "Contact", href: "/#contact" },
];

// Original CDN URLs, used until the assets are uploaded to our own storage.
const IMG = {
  portrait: "https://assets.cdn.filesafe.space/40rq2210I0idDREaOysb/media/671ff30bae0642140e182ea1.jpeg",
  logo: "https://assets.cdn.filesafe.space/40rq2210I0idDREaOysb/media/671ffc3040adeb6a39b6d405.png",
  map: "https://firebasestorage.googleapis.com/v0/b/highlevel-backend.appspot.com/o/location%2F40rq2210I0idDREaOysb%2Fimages%2F6TKDwF1UHJR8XKCQXiKE%2FChIJFzpuN2hhvUcR7Viv9TO3t0Y%2Fmap-FKWfGDA8WZ.jpg?alt=media",
};
/** Local filenames of the captured originals, for --images. */
const ASSET_FILES = {
  portrait: "671ff30bae0642140e182ea1.jpeg",
  logo: "671ffc3040adeb6a39b6d405.png",
  map: "map-contact.png",
};

const sec = (id, name, opts) => ({
  id, name,
  width: "full",
  background: opts.bg ? { kind: "color", color: opts.bg } : { kind: "none" },
  padding: opts.pad ?? [56, 56],
  columns: opts.columns,
});

// ── Shared header / footer ────────────────────────────────────────────────────
const HEADER = [
  sec("hdr", "Header", {
    bg: VIOLET,
    pad: [20, 20],
    columns: [
      [{ id: "hdr-logo", type: "logo", url: IMG.logo, alt: "B2 Consultants", height: 64 }],
      [{ id: "hdr-nav", type: "nav", align: "right" }],
    ],
  }),
];

const FOOTER = [
  sec("ftr", "Footer", {
    pad: [28, 28],
    columns: [[
      { id: "ftr-c", type: "text", text: "© B2 Consultants", align: "center" },
      { id: "ftr-l", type: "footerLinks", align: "center", items: ["Privacy Policy|/privacy", "Terms|/terms"] },
    ]],
  }),
];

// ── Pages ─────────────────────────────────────────────────────────────────────
const CTA = (id) => ({
  id, type: "button", label: "Watch Free Training",
  href: "https://optin.b2consultants.de/lp", align: "center", forwardParams: true,
});

const HOME = [
  sec("hero", "Hero", {
    pad: [56, 64],
    columns: [[
      { id: "hero-img", type: "image", url: IMG.portrait, alt: "Founder, B2 Consultants",
        rounded: true, width: 520, height: 520, align: "center" },
      { id: "hero-h", type: "heading", text: "B² CONSULTANTS", align: "center" },
      { id: "hero-p", type: "text", align: "center",
        text: "Helping IT & Mechanical professionals with 3+ years of experience get a high paying job in Germany with our GCA System in less than 6 months, or you don't pay us." },
      CTA("hero-cta"),
    ]],
  }),
  sec("about", "About Me", {
    bg: VIOLET,
    pad: [56, 56],
    columns: [
      [
        { id: "ab-h", type: "subheading", text: "About Me", align: "center" },
        { id: "ab-1", type: "text",
          text: "I am an Indian descent entrepreneur living in Germany. I've been involved in career coaching for over 7 years now, and have helped several professionals get high paying jobs in Germany." },
        { id: "ab-2", type: "text",
          text: "Back in 2015, I was exactly where you are now-applying to 100's of jobs with nothing but rejection, no guidance on navigating the German job market, overwhelmed with negativity, losing hope, and feeling stuck. Nothing worked, and I was trapped in a cycle I didn't know how to break free from." },
      ],
      [
        { id: "ab-3", type: "text",
          text: "Exactly 10 months later, I landed my dream job in Germany at 40x my salary in India. I finally cracked the strategies that convert-drawing in multiple interview calls and job offers. It was like watching my career take off like a shooting star." },
        { id: "ab-4", type: "text",
          text: "Since then, I've been educating and empowering people facing career growth challenges or financial struggles, helping 100's of students and professionals achieve their dreams in Germany. Now, my mission is to guide even more individuals like you to achieve similar-or greater-success." },
      ],
    ],
  }),
  sec("contact", "Contact", {
    pad: [48, 24],
    columns: [[
      { id: "ct-h", type: "subheading", text: "Contact", align: "center" },
      { id: "ct-1", type: "text", text: "To get in touch with us please use the following information:" },
      { id: "ct-2", type: "text",
        text: "Customers: For support, please use our private WhatsApp Group Channel, Skool Community, or attend the Monthly Q&A calls." },
      // The live page shows this address through Cloudflare's email-protection obfuscation
      // ("[email protected]"). Restored to the real address rather than reproducing the artefact.
      { id: "ct-3", type: "text",
        text: "General Enquiries: Please send an email to info@b2consultants.de We aim to respond to all enquiries within 1 business day." },
      { id: "ct-4", type: "text", text: "Locations: If you require postal information please contact us." },
    ]],
  }),
  sec("addr", "Address and map", {
    pad: [24, 40],
    columns: [
      [
        { id: "ad-h", type: "subheading", text: "B2 Consultants" },
        { id: "ad-t", type: "text", text: "Alter Weg 49\n64385 Reichelsheim\nGermany\ninfo@b2consultants.de" },
      ],
      [{ id: "ad-m", type: "image", url: IMG.map, alt: "Office location, Reichelsheim", width: 720, height: 400 }],
    ],
  }),
  sec("cta2", "Closing CTA", { pad: [24, 48], columns: [[CTA("cta2-b")]] }),
];

const ABOUTUS = [
  sec("au-h", "Heading", {
    pad: [56, 24],
    columns: [[{ id: "au-t", type: "heading", text: "About Us", align: "center" }]],
  }),
  sec("au-b", "Body", {
    bg: VIOLET,
    pad: [48, 48],
    columns: [[{ id: "au-p", type: "text",
      text: "Paste the About Us copy here - the live page's wording is in the capture, and this section is laid out to receive it." }]],
  }),
  sec("au-c", "CTA", { pad: [32, 48], columns: [[CTA("au-cta")]] }),
];

const CAREER = [
  sec("cr-h", "Heading", {
    pad: [56, 24],
    columns: [[{ id: "cr-t", type: "heading", text: "Career", align: "center" }]],
  }),
  sec("cr-b", "Body", {
    pad: [24, 48],
    columns: [[{ id: "cr-p", type: "text",
      text: "Paste the Career copy here. NOTE: the live page is the longest of the five (16 rows) and may carry an application form - if it does, build it in Forms so submissions land in the CRM." }]],
  }),
];

const legal = (title, note) => [
  sec("lg-h", title, { pad: [56, 16], columns: [[{ id: "lg-t", type: "heading", text: title, align: "center" }]] }),
  sec("lg-b", "Body", { pad: [16, 56], columns: [[{ id: "lg-p", type: "text", text: note }]] }),
];

const PAGES = [
  { path: "/", title: "Home", sections: HOME,
    seoTitle: "B2 Consultants - high paying jobs in Germany for IT & Mechanical professionals" },
  { path: "/aboutus", title: "About Us", sections: ABOUTUS },
  { path: "/career", title: "Career", sections: CAREER },
  // Legal pages carry no marketing value in search and their wording is a legal matter, so they
  // are created as noIndex shells for the real text to be pasted in.
  { path: "/privacy", title: "Privacy Policy", noIndex: true,
    sections: legal("Privacy Policy", "Paste the privacy policy from the live page.") },
  { path: "/terms", title: "Terms", noIndex: true,
    sections: legal("Terms", "Paste the terms from the live page.") },
];

// ── Image upload ──────────────────────────────────────────────────────────────
async function uploadAssets() {
  const url = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || "site-media";
  if (!url || !key) {
    console.warn("!  SUPABASE_SERVICE_ROLE_KEY not set - keeping the GHL CDN URLs.");
    console.warn("   The rebuilt site will still render, but it depends on the platform you are leaving.");
    return null;
  }
  if (!ASSET_DIR || !existsSync(ASSET_DIR)) {
    console.warn(`!  --assets <dir> missing or not found (${ASSET_DIR || "unset"}) - keeping CDN URLs.`);
    return null;
  }

  const out = {};
  for (const [name, file] of Object.entries(ASSET_FILES)) {
    const full = path.join(ASSET_DIR, file);
    if (!existsSync(full)) { console.warn(`!  missing asset ${file}`); continue; }
    const body = readFileSync(full);
    const ext = path.extname(file).slice(1).toLowerCase();
    const type = ext === "jpeg" || ext === "jpg" ? "image/jpeg" : `image/${ext}`;
    const stamp = new Date();
    const k = `${stamp.getUTCFullYear()}${String(stamp.getUTCMonth() + 1).padStart(2, "0")}/b2-${name}-${randomBytes(4).toString("hex")}.${ext}`;

    const res = await fetch(`${url}/storage/v1/object/${bucket}/${k}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": type,
        "cache-control": "public, max-age=31536000, immutable",
        "x-upsert": "false",
      },
      body: new Uint8Array(body),
    });
    if (!res.ok) { console.warn(`!  upload failed for ${file}: ${res.status} ${await res.text().catch(() => "")}`); continue; }

    out[name] = `${url}/storage/v1/object/public/${bucket}/${k}`;
    await prisma.mediaAsset.create({
      data: { storageKey: k, url: out[name], filename: file, mimeType: type, bytes: body.length },
    });
    console.log(`   uploaded ${file}`);
  }
  return out;
}

/** Swap CDN URLs for uploaded ones, wherever they appear. */
function rewrite(sections, map) {
  if (!map) return sections;
  const swap = (u) => Object.entries(IMG).find(([, v]) => v === u)?.[0];
  return JSON.parse(JSON.stringify(sections), (k, v) => {
    if (k === "url" && typeof v === "string") {
      const name = swap(v);
      return name && map[name] ? map[name] : v;
    }
    return v;
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────
console.log(APPLY ? "Applying…" : "DRY RUN - pass --apply to write. Nothing is changed.\n");
console.log(`Site  : b2consultants  (/s/b2consultants)`);
console.log(`Theme : ${THEME.primary}, ${THEME.headingFont.split(",")[0]} / ${THEME.bodyFont.split(",")[0]}, ${THEME.contentWidth}px`);
console.log(`Nav   : ${NAV.map((n) => n.label).join(" · ")}`);
for (const p of PAGES) {
  console.log(`Page  : ${p.path.padEnd(10)} ${String(p.sections.length).padStart(2)} sections  ${p.noIndex ? "(noindex)" : ""}`);
}

if (!APPLY) {
  console.log("\nNothing written.");
  await prisma.$disconnect();
  process.exit(0);
}

const map = WITH_IMAGES ? await uploadAssets() : null;
if (WITH_IMAGES && !map) console.log("   (continuing with CDN URLs)");

const existing = await prisma.site.findUnique({ where: { slug: "b2consultants" }, select: { id: true } });
if (existing) {
  // Refresh in place rather than delete-and-recreate: the site id appears in URLs the team may
  // have bookmarked, and dropping the row would take its pages' revision history with it.
  await prisma.site.update({
    where: { id: existing.id },
    data: { theme: THEME, navMenu: NAV },
  });
}

const site = existing ?? await prisma.site.create({
  data: { name: "B2 Consultants", slug: "b2consultants", theme: THEME, navMenu: NAV, published: false },
});

for (const [kind, blocks] of [["HEADER", HEADER], ["FOOTER", FOOTER]]) {
  const found = await prisma.siteSection.findFirst({ where: { siteId: site.id, kind }, select: { id: true } });
  const data = { name: kind === "HEADER" ? "Header" : "Footer", blocks: rewrite(blocks, map) };
  if (found) await prisma.siteSection.update({ where: { id: found.id }, data });
  else await prisma.siteSection.create({ data: { siteId: site.id, kind, ...data } });
}

for (const p of PAGES) {
  const found = await prisma.sitePage.findUnique({
    where: { siteId_path: { siteId: site.id, path: p.path } },
    select: { id: true },
  });
  const data = {
    title: p.title,
    sections: rewrite(p.sections, map),
    seoTitle: p.seoTitle ?? null,
    noIndex: p.noIndex ?? false,
  };
  if (found) await prisma.sitePage.update({ where: { id: found.id }, data });
  else await prisma.sitePage.create({ data: { siteId: site.id, path: p.path, ...data } });
  console.log(`   ${found ? "updated" : "created"} ${p.path}`);
}

console.log(`\nDone. The site and its pages are DRAFTS - review at /sites/${site.id}, then publish.`);
console.log("Publishing is deliberately not automated: this is the public face of the business.");
await prisma.$disconnect();
