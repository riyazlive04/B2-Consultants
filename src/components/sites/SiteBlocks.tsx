import type { Block } from "@/lib/sites-types";
import type { PublicForm as PublicFormType } from "@/server/forms-metrics";
import PublicForm from "./PublicForm";

const ALIGN: Record<string, string> = { left: "text-left", center: "text-center", right: "text-right" };

/** Renders a single block. Shared by the top-level list and recursively by "row" columns. */
function renderBlock(b: Block, forms: Record<string, PublicFormType>, utm?: Record<string, string>) {
  const align = ALIGN[b.align ?? "left"] ?? "text-left";
  switch (b.type) {
    case "heading":
      return <h1 key={b.id} className={`font-display text-display-l font-bold text-ink ${align}`}>{b.text}</h1>;
    case "subheading":
      return <h2 key={b.id} className={`font-display text-h1 font-semibold text-ink ${align}`}>{b.text}</h2>;
    case "text":
      return <p key={b.id} className={`whitespace-pre-wrap text-base leading-relaxed text-ink-2 ${align}`}>{b.text}</p>;
    case "image":
      // eslint-disable-next-line @next/next/no-img-element
      return b.url ? <img key={b.id} src={b.url} alt={b.alt ?? ""} className="mx-auto max-w-full rounded-card" /> : null;
    case "video":
      return b.url ? (
        <div key={b.id} className="relative overflow-hidden rounded-card" style={{ paddingTop: "56.25%" }}>
          <iframe src={b.url} className="absolute inset-0 h-full w-full" allowFullScreen title="Video" />
        </div>
      ) : null;
    case "button":
      return (
        <div key={b.id} className={align}>
          <a
            href={b.href || "#"}
            className={`inline-flex h-12 items-center justify-center rounded-btn px-6 text-base font-semibold ${
              b.variant === "soft"
                ? "bg-primary-soft text-primary-strong"
                : b.variant === "outline"
                  ? "border border-primary text-primary-strong"
                  : "bg-primary text-on-accent hover:bg-primary-strong"
            }`}
          >
            {b.label || "Continue"}
          </a>
        </div>
      );
    case "bullets":
      return (
        <ul key={b.id} className="mx-auto max-w-xl list-disc space-y-1.5 pl-6 text-ink-2">
          {(b.items ?? []).map((it, i) => <li key={i}>{it}</li>)}
        </ul>
      );
    case "divider":
      return <hr key={b.id} className="border-line" />;
    case "spacer":
      return <div key={b.id} style={{ height: b.size ?? 24 }} />;
    case "form":
      return b.formId && forms[b.formId] ? (
        <div key={b.id} className="mx-auto max-w-md"><PublicForm form={forms[b.formId]} utm={utm} /></div>
      ) : (
        <p key={b.id} className="text-center text-sm text-ink-3">[form not published]</p>
      );
    case "row":
      // Responsive 2-(or more)-column layout — stacks to a single column on small screens,
      // matching the app's existing `grid grid-cols-1 sm:grid-cols-2` breakpoint convention.
      return (
        <div key={b.id} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {(b.columns ?? []).map((col, ci) => (
            <div key={ci} className="space-y-5">
              {col.map((cb) => renderBlock(cb, forms, utm))}
            </div>
          ))}
        </div>
      );
    default:
      return null;
  }
}

/** Renders a funnel step's Block[] on a public page. Server component; embedded forms hydrate. */
export default function SiteBlocks({
  blocks,
  forms,
  utm,
}: {
  blocks: Block[];
  forms: Record<string, PublicFormType>;
  utm?: Record<string, string>;
}) {
  return (
    <div className="space-y-5">
      {blocks.map((b) => renderBlock(b, forms, utm))}
    </div>
  );
}
