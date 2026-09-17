import type { ParsedHtml } from "./html-parser";

/**
 * Real, evidence-citing technology detection — every match records the exact
 * header/HTML string that triggered it, never a bare guess. A documented
 * signature table, same spirit as the rest of this app's "no fabricated
 * findings" convention. Not exhaustive of every framework in existence — a
 * reasonable, honestly-scoped signature set covering the brief's examples.
 */

export type TechnologyCategory =
  | "FRONTEND"
  | "BACKEND"
  | "CMS"
  | "ECOMMERCE"
  | "HOSTING"
  | "CDN"
  | "ANALYTICS"
  | "PAYMENT"
  | "BOOKING"
  | "CRM_INDICATOR"
  | "MESSAGING"
  | "OTHER";

export interface TechnologyFinding {
  name: string;
  category: TechnologyCategory;
  evidence: string;
}

interface DetectorContext {
  headers: Headers;
  html: string;
  parsed: ParsedHtml;
  cookies: string[];
}

interface SignatureRule {
  name: string;
  category: TechnologyCategory;
  test: (ctx: DetectorContext) => string | null; // returns evidence string, or null if not matched
}

function headerIncludes(headers: Headers, name: string, substring: string): string | null {
  const value = headers.get(name);
  if (value && value.toLowerCase().includes(substring.toLowerCase())) {
    return `Header "${name}: ${value}"`;
  }
  return null;
}

function scriptSrcMatches(ctx: DetectorContext, pattern: string): string | null {
  const match = ctx.parsed.scriptSrcs.find((src) => src.toLowerCase().includes(pattern.toLowerCase()));
  return match ? `Script source containing "${pattern}": ${match}` : null;
}

function htmlIncludes(ctx: DetectorContext, pattern: string, label?: string): string | null {
  return ctx.html.includes(pattern) ? `HTML contains "${label ?? pattern}"` : null;
}

function cookieIncludes(ctx: DetectorContext, pattern: string): string | null {
  const match = ctx.cookies.find((c) => c.toLowerCase().includes(pattern.toLowerCase()));
  return match ? `Cookie name matches "${pattern}"` : null;
}

const SIGNATURES: SignatureRule[] = [
  // Frontend frameworks
  { name: "Next.js", category: "FRONTEND", test: (ctx) => scriptSrcMatches(ctx, "/_next/") ?? htmlIncludes(ctx, "__NEXT_DATA__") },
  { name: "React", category: "FRONTEND", test: (ctx) => htmlIncludes(ctx, "data-reactroot") ?? htmlIncludes(ctx, "data-reactid") },
  { name: "Angular", category: "FRONTEND", test: (ctx) => (ctx.html.match(/\sng-version="/i) ? 'HTML contains "ng-version" attribute' : null) },
  { name: "Vue.js", category: "FRONTEND", test: (ctx) => (ctx.html.match(/\sdata-v-[a-f0-9]{6,}/i) ? 'HTML contains Vue scoped "data-v-*" attributes' : null) },

  // CMS
  { name: "WordPress", category: "CMS", test: (ctx) => scriptSrcMatches(ctx, "wp-content") ?? scriptSrcMatches(ctx, "wp-includes") ?? (ctx.parsed.metaGenerator?.toLowerCase().includes("wordpress") ? `Meta generator tag: "${ctx.parsed.metaGenerator}"` : null) },
  { name: "WooCommerce", category: "ECOMMERCE", test: (ctx) => htmlIncludes(ctx, "woocommerce") },
  { name: "Shopify", category: "ECOMMERCE", test: (ctx) => scriptSrcMatches(ctx, "cdn.shopify.com") ?? htmlIncludes(ctx, "Shopify.theme") },
  { name: "Magento", category: "ECOMMERCE", test: (ctx) => cookieIncludes(ctx, "mage-cache") ?? htmlIncludes(ctx, "Mage.Cookies") },
  { name: "Wix", category: "CMS", test: (ctx) => (ctx.parsed.metaGenerator?.toLowerCase().includes("wix") ? `Meta generator tag: "${ctx.parsed.metaGenerator}"` : null) },
  { name: "Squarespace", category: "CMS", test: (ctx) => htmlIncludes(ctx, "static1.squarespace.com") },

  // Backend / language signals
  { name: "PHP", category: "BACKEND", test: (ctx) => headerIncludes(ctx.headers, "x-powered-by", "php") },
  { name: "ASP.NET", category: "BACKEND", test: (ctx) => headerIncludes(ctx.headers, "x-powered-by", "asp.net") ?? headerIncludes(ctx.headers, "x-aspnet-version", "") ?? cookieIncludes(ctx, "asp.net_sessionid") },
  { name: "Laravel", category: "BACKEND", test: (ctx) => cookieIncludes(ctx, "laravel_session") },
  { name: "Django", category: "BACKEND", test: (ctx) => cookieIncludes(ctx, "csrftoken") ?? cookieIncludes(ctx, "django") },
  { name: "Express / Node.js", category: "BACKEND", test: (ctx) => headerIncludes(ctx.headers, "x-powered-by", "express") },
  { name: "Ruby on Rails", category: "BACKEND", test: (ctx) => cookieIncludes(ctx, "_session_id") },

  // Hosting / CDN
  { name: "Vercel", category: "HOSTING", test: (ctx) => (ctx.headers.get("x-vercel-id") ? `Header "x-vercel-id: ${ctx.headers.get("x-vercel-id")}"` : null) },
  { name: "Cloudflare", category: "CDN", test: (ctx) => headerIncludes(ctx.headers, "server", "cloudflare") ?? (ctx.headers.get("cf-ray") ? `Header "cf-ray: ${ctx.headers.get("cf-ray")}"` : null) },
  { name: "AWS CloudFront", category: "CDN", test: (ctx) => (ctx.headers.get("x-amz-cf-id") ? `Header "x-amz-cf-id: ${ctx.headers.get("x-amz-cf-id")}"` : null) },
  { name: "AWS", category: "HOSTING", test: (ctx) => headerIncludes(ctx.headers, "server", "amazons3") ?? headerIncludes(ctx.headers, "x-amz-request-id", "") },
  { name: "Azure", category: "HOSTING", test: (ctx) => (ctx.headers.get("x-azure-ref") ? `Header "x-azure-ref: ${ctx.headers.get("x-azure-ref")}"` : null) },
  { name: "Google Cloud", category: "HOSTING", test: (ctx) => headerIncludes(ctx.headers, "server", "google frontend") ?? headerIncludes(ctx.headers, "via", "google") },
  { name: "Nginx", category: "HOSTING", test: (ctx) => headerIncludes(ctx.headers, "server", "nginx") },
  { name: "Apache", category: "HOSTING", test: (ctx) => headerIncludes(ctx.headers, "server", "apache") },

  // Analytics
  { name: "Google Analytics", category: "ANALYTICS", test: (ctx) => scriptSrcMatches(ctx, "googletagmanager.com") ?? scriptSrcMatches(ctx, "google-analytics.com") },
  { name: "Meta Pixel", category: "ANALYTICS", test: (ctx) => htmlIncludes(ctx, "connect.facebook.net") },
  { name: "Hotjar", category: "ANALYTICS", test: (ctx) => scriptSrcMatches(ctx, "hotjar.com") },

  // Payment gateways — matched on each provider's real checkout/JS-SDK script host.
  { name: "Razorpay", category: "PAYMENT", test: (ctx) => scriptSrcMatches(ctx, "checkout.razorpay.com") },
  { name: "Stripe", category: "PAYMENT", test: (ctx) => scriptSrcMatches(ctx, "js.stripe.com") },
  { name: "PayPal", category: "PAYMENT", test: (ctx) => scriptSrcMatches(ctx, "paypalobjects.com") ?? scriptSrcMatches(ctx, "paypal.com/sdk/js") },
  { name: "PayU", category: "PAYMENT", test: (ctx) => scriptSrcMatches(ctx, "jssdk.payu.in") },
  { name: "Instamojo", category: "PAYMENT", test: (ctx) => scriptSrcMatches(ctx, "js.instamojo.com") },
  // CCAvenue's seamless integration has no client-side SDK script — it posts to this transaction endpoint as the form action, so this is a raw-HTML substring match rather than a parsed script tag.
  { name: "CCAvenue", category: "PAYMENT", test: (ctx) => htmlIncludes(ctx, "secure.ccavenue.com/transaction/transaction.do", "CCAvenue transaction form action") },

  // Booking / scheduling widgets — matched on each provider's embed script host, with a raw-HTML fallback for iframe-only embeds.
  { name: "Calendly", category: "BOOKING", test: (ctx) => scriptSrcMatches(ctx, "assets.calendly.com") ?? htmlIncludes(ctx, "calendly.com/", "Calendly booking link/iframe") },
  { name: "Acuity Scheduling", category: "BOOKING", test: (ctx) => scriptSrcMatches(ctx, "embed.acuityscheduling.com") ?? htmlIncludes(ctx, "acuityscheduling.com", "Acuity Scheduling iframe/link") },
  { name: "Cal.com", category: "BOOKING", test: (ctx) => scriptSrcMatches(ctx, "app.cal.com/embed") ?? htmlIncludes(ctx, "cal.com/embed", "Cal.com embed reference") },
  // Setmore's embed code is account-specific (no shared script host) — booking pages always live at a "<account>.setmore.com" subdomain, so that's the only stable, honest substring to match.
  { name: "Setmore", category: "BOOKING", test: (ctx) => htmlIncludes(ctx, ".setmore.com", "Setmore booking page link") },

  // CRM indicators — tracking scripts and web-to-lead form endpoints that only exist when a CRM is wired up.
  { name: "HubSpot", category: "CRM_INDICATOR", test: (ctx) => scriptSrcMatches(ctx, "js.hs-scripts.com") ?? scriptSrcMatches(ctx, "js.hsforms.net") },
  // Salesforce Web-to-Lead forms always post to this exact endpoint — no client-side SDK to match on.
  { name: "Salesforce", category: "CRM_INDICATOR", test: (ctx) => htmlIncludes(ctx, "webto.salesforce.com/servlet/servlet.WebToLead", "Salesforce Web-to-Lead form action") },
  // Zoho CRM's embedded webforms post to this endpoint.
  { name: "Zoho CRM", category: "CRM_INDICATOR", test: (ctx) => htmlIncludes(ctx, "crm.zoho.com/crm/WebToLeadForm", "Zoho CRM Web-to-Lead form action") },

  // Messaging widgets
  { name: "WhatsApp Click-to-Chat", category: "MESSAGING", test: (ctx) => htmlIncludes(ctx, "wa.me/", "WhatsApp click-to-chat link") ?? htmlIncludes(ctx, "api.whatsapp.com", "WhatsApp API link") },
  { name: "Intercom", category: "MESSAGING", test: (ctx) => scriptSrcMatches(ctx, "widget.intercom.io") },
  { name: "Tidio", category: "MESSAGING", test: (ctx) => scriptSrcMatches(ctx, "code.tidio.co") },
  { name: "Crisp", category: "MESSAGING", test: (ctx) => scriptSrcMatches(ctx, "client.crisp.chat") },
];

/** Runs every documented signature rule and returns only real matches, each carrying its evidence. */
export function detectTechnologies(headers: Headers, parsed: ParsedHtml): TechnologyFinding[] {
  const setCookieEntries = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [headers.get("set-cookie") ?? ""];
  const cookies = setCookieEntries
    .flatMap((c) => c.split(","))
    .map((c) => c.trim().split("=")[0])
    .filter(Boolean);

  const ctx: DetectorContext = { headers, html: parsed.rawHtml, parsed, cookies };

  const findings: TechnologyFinding[] = [];
  for (const sig of SIGNATURES) {
    const evidence = sig.test(ctx);
    if (evidence) findings.push({ name: sig.name, category: sig.category, evidence });
  }
  return findings;
}
