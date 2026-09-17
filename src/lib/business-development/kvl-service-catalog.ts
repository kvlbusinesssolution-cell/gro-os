/**
 * KVL Service Catalog — the single source of truth for the structured list
 * of services KVL sells. Both the AI service-matching logic
 * (`opportunity-engine.ts`) and the dashboard UI import `KVL_SERVICES` from
 * here; the list must never be hardcoded anywhere else (spec: "do not
 * hardcode service logic inside UI components").
 *
 * Descriptions are written to be genuinely distinguishing — they are fed
 * into the AI prompt as matching context, so overlapping services (e.g. CRM
 * vs BUSINESS_AUTOMATION vs AI_AUTOMATION) each call out what makes them the
 * right (or wrong) fit.
 */
export const KVL_SERVICES = [
  {
    id: "WEBSITE_DEVELOPMENT",
    label: "Website Development",
    description:
      "Designing and building a company's core marketing/informational website (new build, redesign, or migration off an outdated or unmaintained site) — not a storefront, not an app, and not internal tooling.",
  },
  {
    id: "ECOMMERCE_DEVELOPMENT",
    label: "E-commerce Development",
    description:
      "Building or upgrading an online storefront with product catalog, cart, checkout, and payment processing — for companies that sell products online or want to start, distinct from a general marketing website with no transactional selling.",
  },
  {
    id: "SAAS_DEVELOPMENT",
    label: "SaaS Development",
    description:
      "Designing and building a new multi-tenant, subscription-billed software product the company will sell or operate as its own product — distinct from custom software built for the company's own internal, single-tenant use.",
  },
  {
    id: "MOBILE_APP_DEVELOPMENT",
    label: "Mobile App Development",
    description:
      "Building a native or cross-platform iOS/Android application for the company's customers or staff — distinct from a responsive website or web app accessed through a mobile browser.",
  },
  {
    id: "CRM",
    label: "CRM",
    description:
      "Implementing or upgrading a system of record for tracking leads, customers, deals, and sales/support interactions — for companies with no CRM, a spreadsheet-based process, or an outgrown/misfit CRM tool; not for automating workflows once a CRM already exists (see BUSINESS_AUTOMATION) and not for AI-driven decisioning (see AI_SOLUTIONS/AI_AUTOMATION).",
  },
  {
    id: "ERP",
    label: "ERP",
    description:
      "Implementing or upgrading an integrated system for core back-office operations — finance, inventory, procurement, manufacturing, or HR — for companies coordinating these processes across disconnected spreadsheets or legacy systems; broader in scope than a single-function CRM.",
  },
  {
    id: "AI_SOLUTIONS",
    label: "AI Solutions",
    description:
      "Building a custom AI/ML-powered feature or product capability — e.g. recommendation engines, predictive models, computer vision, or generative AI features embedded in the company's product or customer experience; distinct from automating an existing internal workflow (see AI_AUTOMATION).",
  },
  {
    id: "AI_AUTOMATION",
    label: "AI Automation",
    description:
      "Using AI to automate an existing internal business process or decision (e.g. AI-drafted responses, intelligent document processing, lead scoring, content generation) — distinct from building a new AI-powered product feature (see AI_SOLUTIONS) and from simple rule-based workflow automation with no AI/ML component (see BUSINESS_AUTOMATION).",
  },
  {
    id: "WHATSAPP_AUTOMATION",
    label: "WhatsApp Automation",
    description:
      "Automating customer communication, order updates, or support specifically through the WhatsApp Business API (chatbots, notifications, catalog/ordering flows) — for companies whose customers primarily communicate via WhatsApp; a specific channel automation, not general business-process automation.",
  },
  {
    id: "BUSINESS_AUTOMATION",
    label: "Business Automation",
    description:
      "Automating repetitive, rule-based internal operational workflows (e.g. connecting existing tools, automating data entry, approvals, notifications, scheduling) using deterministic logic/integrations rather than AI/ML — distinct from AI_AUTOMATION (which involves AI/ML decisioning) and from implementing a new system of record like CRM or ERP.",
  },
  {
    id: "SEO",
    label: "SEO",
    description:
      "Improving a company's organic search visibility and rankings — technical SEO fixes, content/keyword strategy, on-page optimization, and site-speed/structure improvements that affect search performance; not a full website rebuild unless the SEO issues stem directly from the site's technical foundation.",
  },
  {
    id: "CUSTOM_SOFTWARE_DEVELOPMENT",
    label: "Custom Software Development",
    description:
      "Building bespoke internal software or tooling tailored to the company's own unique operations (not sold externally, not a SaaS product, not a public-facing website or app) — for needs too specific for any off-the-shelf CRM, ERP, or automation tool to solve.",
  },
] as const;

export type KVLServiceId = (typeof KVL_SERVICES)[number]["id"];
