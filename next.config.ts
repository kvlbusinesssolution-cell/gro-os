import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";
import bundleAnalyzer from "@next/bundle-analyzer";

const nextConfig: NextConfig = {
  // pdfkit reads its .afm font files from disk relative to its own package
  // directory at runtime (native Node.js `fs`/`__dirname` usage) — bundling
  // it rewrites those paths and breaks font loading, so it must run via
  // native `require` instead. See src/lib/export/pdf.ts.
  // fontkit: same bundler-interference reason as pdfkit below — its
  // package.json "exports" map resolves to a browser build without real
  // filesystem access unless left external to Node's own CJS resolution
  // (src/lib/career/cv-pdf-renderer.ts also forces this via createRequire
  // for Vitest, which doesn't read this Next.js-specific config).
  serverExternalPackages: ["pdfkit", "fontkit"],

  // Required for the multi-stage Docker build (Dockerfile) — copies only
  // the traced production dependency subset + server bundle into the
  // runner stage instead of the full node_modules tree. See
  // node_modules/next/dist/docs/01-app/02-guides/self-hosting.md.
  output: "standalone",

  // `compress` (gzip/brotli of served assets) is on by default and nothing
  // here disables it — left unset deliberately rather than restated.

  // The compliance self-check (src/lib/security/compliance.ts, rendered at
  // /admin/compliance) reads these exact source files at request time to
  // verify real controls actually exist in the deployed code — see that
  // file's top comment. Its path.join call is turbopackIgnore'd (dynamic by
  // design, not attacker-influenced) so tracing doesn't fall back to
  // including the whole repo; list the real fixed file set explicitly here
  // instead so it still ships in the standalone production output.
  outputFileTracingIncludes: {
    "/admin/compliance": [
      "src/lib/scheduler/registry.ts",
      "src/components/cookie-consent-banner.tsx",
      "src/lib/cookie-consent.ts",
      "src/app/profile/actions.ts",
      "src/app/company/actions.ts",
      "src/app/profile/dsr-actions.ts",
      "prisma/schema.prisma",
      "eslint.config.mjs",
    ],
  },

  images: {
    // Verified real image usage across src/ (grep for `next/image`): the
    // only call site is the 2FA enrollment QR code
    // (src/app/profile/_components/two-factor-section.tsx), rendered from a
    // locally-generated `data:` URL, never a remote host — so no
    // `remotePatterns`/`domains` entry is genuinely needed today. Add one
    // here if a real external image source is introduced.
    formats: ["image/avif", "image/webp"],
  },
};

// Real bundle-size inspection (Phase 20 performance work) — opt-in via
// ANALYZE=true so a normal `next build` never pays the extra
// analysis/report-generation cost. Usage: `ANALYZE=true npm run build`,
// which opens a real, generated treemap of the actual production bundle.
const withBundleAnalyzer = bundleAnalyzer({ enabled: process.env.ANALYZE === "true" });

// withSentryConfig is safe to apply unconditionally — it only actually does
// anything (source map upload, build annotation) when real Sentry
// credentials are present; `silent: true` and the sourcemaps.disable guard
// below keep the build quiet and skip upload entirely when they're not (the
// default in this environment until real Sentry credentials are supplied —
// see .env.example). It never affects whether the app itself reports errors
// to Sentry at runtime — that's gated purely on SENTRY_DSN in
// sentry.server.config.ts / sentry.edge.config.ts / src/instrumentation-client.ts.
export default withSentryConfig(withBundleAnalyzer(nextConfig), {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: true,
  webpack: { treeshake: { removeDebugLogging: true } },
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
  telemetry: false,
});
