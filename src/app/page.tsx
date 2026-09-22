import type { Metadata } from "next";

import { NavbarWithSession as Navbar } from "@/components/sections/navbar-with-session";
import { Hero } from "@/components/sections/hero";
import { AIAgents } from "@/components/sections/ai-agents";
import { Workflow } from "@/components/sections/workflow";
import { CareerAgentSection } from "@/components/sections/career-agent";
import { RoiCalculator } from "@/components/sections/roi-calculator";
import { CTA } from "@/components/sections/cta";
import { Footer } from "@/components/sections/footer";

export const metadata: Metadata = {
  title: "KVL GrowthOS — The AI Workforce That Grows Your Business 24/7",
  description:
    "A team of AI agents that qualifies leads, runs outreach, drafts proposals, and prioritizes your pipeline around the clock — so deals move forward whether or not anyone's logged in.",
  alternates: { canonical: "/" },
};

/**
 * Testimonials, pricing, security, and FAQ moved to /product to keep this
 * page a fast, light-on-text landing page — see src/app/product/page.tsx,
 * linked from the navbar's "Product tour" item and the anchors below.
 */
export default function Home() {
  return (
    <div className="theme-luxury">
      <Navbar />
      <main>
        <Hero />
        <div id="ai-agents">
          <AIAgents />
        </div>
        <Workflow />
        <div id="career-agent">
          <CareerAgentSection />
        </div>
        <div id="roi-calculator">
          <RoiCalculator />
        </div>
        <div id="cta">
          <CTA />
        </div>
      </main>
      <Footer />
    </div>
  );
}
