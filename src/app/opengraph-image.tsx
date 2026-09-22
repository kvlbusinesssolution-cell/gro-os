import { readFileSync } from "node:fs";
import path from "node:path";
import { ImageResponse } from "next/og";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Satori (next/og's renderer) needs an actual reachable URL or inline data —
// a bare "/images/..." path won't resolve during image generation, so the
// real GROOS logo mark is embedded as a base64 data URI read straight off
// disk, not fetched over the network. This card's background is dark, so
// the dark-mode mark (public/images/groos-mark-dark.png) is the correct
// variant here, not a theme toggle — a static OG image can't switch.
const logoDataUri = `data:image/png;base64,${readFileSync(
  path.join(process.cwd(), "public/images/groos-mark-dark.png"),
).toString("base64")}`;

export default async function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "flex-start",
          padding: "80px",
          backgroundColor: "#0a0f0d",
          backgroundImage:
            "radial-gradient(ellipse 80% 60% at 30% 0%, rgba(16,185,129,0.35), transparent 70%)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <img src={logoDataUri} width={56} height={56} alt="" />
          <div
            style={{
              fontSize: 40,
              fontWeight: 700,
              color: "#fafafa",
            }}
          >
            GrowthOS
          </div>
        </div>
        <div
          style={{
            marginTop: 32,
            fontSize: 56,
            fontWeight: 600,
            lineHeight: 1.15,
            color: "#fafafa",
            maxWidth: 900,
          }}
        >
          The AI Workforce That Grows Your Business 24/7
        </div>
        <div
          style={{
            marginTop: 28,
            fontSize: 26,
            color: "#a1a1aa",
            maxWidth: 820,
          }}
        >
          Five AI agents that qualify leads, run outreach, and move deals
          forward around the clock.
        </div>
      </div>
    ),
    { ...size },
  );
}
