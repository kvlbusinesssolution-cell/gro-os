import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { MotionConfig } from "framer-motion";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/toast";
import { CookieConsentBanner } from "@/components/cookie-consent-banner";
import { SkipToContent } from "@/components/skip-to-content";
import { getSiteUrl } from "@/lib/site-config";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const BASE_URL = getSiteUrl();

const title = "KVL GrowthOS — The AI Workforce That Grows Your Business 24/7";
const description =
  "KVL GrowthOS is a team of AI agents that qualifies leads, runs outreach, drafts proposals, and prioritizes your pipeline around the clock — so deals move forward whether or not anyone's logged in.";

export const metadata: Metadata = {
  metadataBase: new URL(BASE_URL),
  title,
  description,
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title,
    description,
    type: "website",
    url: BASE_URL,
    siteName: "KVL GrowthOS",
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
  },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "KVL GrowthOS",
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
  description,
  url: BASE_URL,
  publisher: {
    "@type": "Organization",
    name: "KVL Business Solutions",
    url: BASE_URL,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full overflow-x-hidden antialiased`}
    >
      <body className="min-h-full flex flex-col overflow-x-hidden">
        <SkipToContent />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        <ThemeProvider
          attribute="data-theme"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          {/* Makes every framer-motion animation in the app respect the OS
              "reduce motion" setting automatically — the CSS reduced-motion
              rule in globals.css only covers plain CSS transitions, not
              framer-motion's JS-driven `variants` (used throughout the
              marketing site's sections). */}
          <MotionConfig reducedMotion="user">
            {children}
            <Toaster />
            <CookieConsentBanner />
          </MotionConfig>
        </ThemeProvider>
      </body>
    </html>
  );
}
