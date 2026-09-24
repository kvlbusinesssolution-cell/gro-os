import type { LandingPageBlock } from "@/lib/validations/marketing";

/** Renders one structured content block (paragraph/image/testimonial/bullets) — shared by every public page that uses this block format (marketing landing pages, business microsite pages), so there's exactly one renderer to keep consistent/secure (never raw HTML). */
export function ContentBlockRenderer({ block }: { block: LandingPageBlock }) {
  switch (block.type) {
    case "paragraph":
      return <p className="text-base leading-relaxed text-muted-foreground">{block.content}</p>;
    case "image":
      return (
        // eslint-disable-next-line @next/next/no-img-element -- arbitrary marketer-supplied external URL, not a static/optimizable asset
        <img src={block.url} alt={block.alt || ""} className="w-full rounded-xl object-cover" />
      );
    case "testimonial":
      return (
        <blockquote className="rounded-xl border border-border bg-card p-6 italic text-foreground">
          &ldquo;{block.quote}&rdquo;
          <footer className="mt-2 text-sm not-italic text-muted-foreground">— {block.author}</footer>
        </blockquote>
      );
    case "bullets":
      return (
        <ul className="flex flex-col gap-2">
          {block.items.map((item, i) => (
            <li key={i} className="flex items-start gap-2 text-foreground">
              <span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" /> {item}
            </li>
          ))}
        </ul>
      );
  }
}
