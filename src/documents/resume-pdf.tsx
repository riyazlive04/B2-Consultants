import { Document, Page, Text, View, Image, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import type { ResumeData } from "@/lib/resume-types";
import {
  orderedEnabledSections,
  sectionLabel,
  type ResumeTemplateConfig,
  type ResumeSectionSetting,
  type ResumeSectionId,
} from "@/lib/resume-template";

/**
 * Resume PDF — renders ResumeData through the founder's template (section order,
 * headings, accent colour, font, page size, photo/DOB toggles). Pure: takes the data
 * + config and returns a Buffer. Mirrors the DOCX generator so both exports match.
 */

const BOLD: Record<ResumeTemplateConfig["style"]["font"], string> = {
  Helvetica: "Helvetica-Bold",
  "Times-Roman": "Times-Bold",
  Courier: "Courier-Bold",
};

function dateRange(start: string, end: string, current: boolean): string {
  const e = current ? "present" : end;
  return [start, e].filter(Boolean).join(" – ");
}

function styles(cfg: ResumeTemplateConfig) {
  const font = cfg.style.font;
  const bold = BOLD[font];
  const accent = cfg.style.accentColor;
  return StyleSheet.create({
    page: { paddingVertical: 36, paddingHorizontal: 40, fontSize: 10, fontFamily: font, color: "#1A2233", lineHeight: 1.4 },
    headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
    name: { fontSize: 22, fontFamily: bold, color: accent },
    headline: { fontSize: 12, color: "#3A465C", marginTop: 2 },
    contact: { fontSize: 9, color: "#4A566E", marginTop: 6 },
    photo: { width: 78, height: 96, objectFit: "cover", borderRadius: 3, marginLeft: 16 },
    rule: { borderBottomWidth: 2, borderColor: accent, marginTop: 10, marginBottom: 4 },
    sectionTitle: { fontSize: 11, fontFamily: bold, color: accent, textTransform: "uppercase", letterSpacing: 0.6, marginTop: 14, marginBottom: 4 },
    itemHead: { flexDirection: "row", justifyContent: "space-between", marginTop: 6 },
    itemTitle: { fontFamily: bold, fontSize: 10.5, flex: 1, paddingRight: 8 },
    itemMeta: { fontSize: 9, color: "#636F85" },
    role: { fontSize: 9.5, color: "#3A465C", marginBottom: 2 },
    bulletRow: { flexDirection: "row", marginTop: 1.5 },
    bulletDot: { width: 10, color: accent },
    bulletText: { flex: 1 },
    para: { marginTop: 2 },
    inline: { marginTop: 2 },
  });
}

type S = ReturnType<typeof styles>;

function Bullets({ items, s }: { items: string[]; s: S }) {
  return (
    <>
      {items.filter(Boolean).map((b, i) => (
        <View key={i} style={s.bulletRow}>
          <Text style={s.bulletDot}>•</Text>
          <Text style={s.bulletText}>{b}</Text>
        </View>
      ))}
    </>
  );
}

function place(city: string, country: string): string {
  const loc = [city, country].filter(Boolean).join(", ");
  return loc ? `, ${loc}` : "";
}

function SectionBody({ id, d, s }: { id: ResumeSectionId; d: ResumeData; s: S }) {
  switch (id) {
    case "highlights":
      return <Bullets items={d.highlights} s={s} />;
    case "summary":
      return <Text style={s.para}>{d.summary}</Text>;
    case "experience":
      return (
        <>
          {d.experience.map((e, i) => (
            <View key={i}>
              <View style={s.itemHead}>
                <Text style={s.itemTitle}>
                  {e.company}
                  {place(e.city, e.country)}
                </Text>
                <Text style={s.itemMeta}>{dateRange(e.start, e.end, e.current)}</Text>
              </View>
              {e.position ? <Text style={s.role}>{e.position}</Text> : null}
              <Bullets items={e.bullets} s={s} />
            </View>
          ))}
        </>
      );
    case "education":
      return (
        <>
          {d.education.map((e, i) => (
            <View key={i}>
              <View style={s.itemHead}>
                <Text style={s.itemTitle}>
                  {e.institution}
                  {place(e.city, e.country)}
                </Text>
                <Text style={s.itemMeta}>{dateRange(e.start, e.end, false)}</Text>
              </View>
              {e.program || e.note ? <Text style={s.role}>{[e.program, e.note].filter(Boolean).join(" — ")}</Text> : null}
            </View>
          ))}
        </>
      );
    case "certifications":
      return <Bullets items={d.certifications.map((c) => [c.name, c.issuer, c.date].filter(Boolean).join(", "))} s={s} />;
    case "languages":
      return (
        <Text style={s.inline}>
          {d.languages.filter((l) => l.name).map((l) => `${l.name}${l.level ? ` (${l.level})` : ""}`).join("   ·   ")}
        </Text>
      );
    case "computer":
      return (
        <Text style={s.inline}>
          {d.computerSkills.filter((c) => c.name).map((c) => `${c.name} — ${c.level}`).join("   ·   ")}
        </Text>
      );
    case "personal":
      return <Text style={s.inline}>{d.personalSkills.filter(Boolean).join("   ·   ")}</Text>;
    case "hobbies":
      return <Text style={s.inline}>{d.hobbies.filter(Boolean).join("   ·   ")}</Text>;
    default:
      return null;
  }
}

/** Is there anything to render for this section? Empty sections are dropped entirely. */
function hasContent(id: ResumeSectionId, d: ResumeData): boolean {
  switch (id) {
    case "highlights":
      return d.highlights.some(Boolean);
    case "summary":
      return d.summary.trim().length > 0;
    case "experience":
      return d.experience.length > 0;
    case "education":
      return d.education.length > 0;
    case "certifications":
      return d.certifications.length > 0;
    case "languages":
      return d.languages.some((l) => l.name);
    case "computer":
      return d.computerSkills.some((c) => c.name);
    case "personal":
      return d.personalSkills.some(Boolean);
    case "hobbies":
      return d.hobbies.some(Boolean);
    default:
      return false;
  }
}

function ResumeDoc({ data, cfg, language }: { data: ResumeData; cfg: ResumeTemplateConfig; language: string }) {
  const s = styles(cfg);
  const h = data.header;
  const enabled = orderedEnabledSections(cfg).filter((sec) => hasContent(sec.id, data));
  const line1 = [h.email, h.phone, h.location].filter(Boolean).join("   ·   ");
  const line2 = [
    cfg.style.showDob && h.dob ? `Born ${h.dob}` : "",
    h.nationality,
    h.relocation,
    h.linkedin,
    h.website,
  ]
    .filter(Boolean)
    .join("   ·   ");

  return (
    <Document>
      <Page size={cfg.style.pageSize} style={s.page}>
        <View style={s.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={s.name}>{h.fullName || "Your Name"}</Text>
            {cfg.style.showHeadline && h.headline ? <Text style={s.headline}>{h.headline}</Text> : null}
            {line1 ? <Text style={s.contact}>{line1}</Text> : null}
            {line2 ? <Text style={s.contact}>{line2}</Text> : null}
          </View>
          {cfg.style.showPhoto && h.photoDataUrl ? <Image style={s.photo} src={h.photoDataUrl} /> : null}
        </View>
        <View style={s.rule} />
        {enabled.map((sec: ResumeSectionSetting) => (
          <View key={sec.id}>
            <Text style={s.sectionTitle}>{sectionLabel(sec, language)}</Text>
            <SectionBody id={sec.id} d={data} s={s} />
          </View>
        ))}
      </Page>
    </Document>
  );
}

export async function renderResumePdf(
  data: ResumeData,
  cfg: ResumeTemplateConfig,
  language: string,
): Promise<Buffer> {
  return renderToBuffer(<ResumeDoc data={data} cfg={cfg} language={language} />);
}
