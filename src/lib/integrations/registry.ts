import { googleGmailAdapter, googleCalendarAdapter } from "./providers/google-oauth";
import { microsoftOutlookAdapter, microsoftCalendarAdapter } from "./providers/microsoft-oauth";
import { docusignAdapter } from "./providers/docusign";
import { adobeSignAdapter } from "./providers/adobe-sign";
import { dropboxSignAdapter } from "./providers/dropbox-sign";
import { sendgridAdapter } from "./providers/sendgrid";
import { mailgunAdapter } from "./providers/mailgun";
import { amazonSesAdapter } from "./providers/amazon-ses";
import { calComAdapter } from "./providers/cal-com";
import { calendlyAdapter } from "./providers/calendly";
import { hubspotAdapter } from "./providers/hubspot";
import { salesforceAdapter } from "./providers/salesforce";
import { zohoCrmAdapter } from "./providers/zoho-crm";
import { pipedriveAdapter } from "./providers/pipedrive";
import { freshsalesAdapter } from "./providers/freshsales";
import { slackAdapter } from "./providers/slack";
import { microsoftTeamsAdapter } from "./providers/microsoft-teams";
import { discordAdapter } from "./providers/discord";
import { telegramAdapter } from "./providers/telegram";
import { twilioAdapter } from "./providers/twilio";
import { linkedinAdapter } from "./providers/linkedin";
import { googleDriveAdapter } from "./providers/google-drive";
import { dropboxAdapter } from "./providers/dropbox";
import { onedriveAdapter } from "./providers/onedrive";
import { awsS3Adapter } from "./providers/aws-s3";
import { cloudflareR2Adapter } from "./providers/cloudflare-r2";
import { stripeAdapter } from "./providers/stripe";
import { razorpayAdapter } from "./providers/razorpay";
import { paypalAdapter } from "./providers/paypal";
import { paddleAdapter } from "./providers/paddle";
import { lemonsqueezyAdapter } from "./providers/lemonsqueezy";
import { quickbooksAdapter } from "./providers/quickbooks";
import { xeroAdapter } from "./providers/xero";
import { zohoBooksAdapter } from "./providers/zoho-books";
import { zoomAdapter } from "./providers/zoom";
import { googleMeetAdapter } from "./providers/google-meet";
import { githubAdapter } from "./providers/github";
import { gitlabAdapter } from "./providers/gitlab";
import { bitbucketAdapter } from "./providers/bitbucket";
import { vercelAdapter } from "./providers/vercel";
import { netlifyAdapter } from "./providers/netlify";
import { cloudflareAdapter } from "./providers/cloudflare";
import { openaiAdapter } from "./providers/openai";
import { googleGeminiAdapter } from "./providers/google-gemini";
import { deepseekAdapter } from "./providers/deepseek";
import { groqAdapter } from "./providers/groq";
import { openrouterAdapter } from "./providers/openrouter";
import { ollamaAdapter } from "./providers/ollama";
import { voyageAdapter } from "./providers/voyage";
import { cohereAdapter } from "./providers/cohere";
import { jinaAdapter } from "./providers/jina";
import { bgeAdapter } from "./providers/bge";
import type { IntegrationAdapter, IntegrationProviderKey } from "./types";

/**
 * Every concrete provider registers itself here — the only file that
 * imports every provider module. Business code and the OAuth
 * callback/connect-with-credentials routes only ever call
 * getAdapter()/listAdapters() — never a concrete provider file directly —
 * so adding a new provider is a two-line change: write the adapter file,
 * add it here.
 */
const ADAPTERS: IntegrationAdapter[] = [
  // Email
  googleGmailAdapter,
  microsoftOutlookAdapter,
  sendgridAdapter,
  mailgunAdapter,
  amazonSesAdapter,
  // Calendar
  googleCalendarAdapter,
  microsoftCalendarAdapter,
  calComAdapter,
  calendlyAdapter,
  // Signature
  docusignAdapter,
  adobeSignAdapter,
  dropboxSignAdapter,
  // CRM sync
  hubspotAdapter,
  salesforceAdapter,
  zohoCrmAdapter,
  pipedriveAdapter,
  freshsalesAdapter,
  // Communication
  slackAdapter,
  microsoftTeamsAdapter,
  discordAdapter,
  telegramAdapter,
  twilioAdapter,
  linkedinAdapter,
  // Storage
  googleDriveAdapter,
  dropboxAdapter,
  onedriveAdapter,
  awsS3Adapter,
  cloudflareR2Adapter,
  // Payments
  stripeAdapter,
  razorpayAdapter,
  paypalAdapter,
  paddleAdapter,
  lemonsqueezyAdapter,
  // Accounting
  quickbooksAdapter,
  xeroAdapter,
  zohoBooksAdapter,
  // Meetings
  zoomAdapter,
  googleMeetAdapter,
  // Development
  githubAdapter,
  gitlabAdapter,
  bitbucketAdapter,
  vercelAdapter,
  netlifyAdapter,
  cloudflareAdapter,
  // AI providers
  openaiAdapter,
  googleGeminiAdapter,
  deepseekAdapter,
  groqAdapter,
  openrouterAdapter,
  ollamaAdapter,
  // Embedding providers (Phase 17 RAG Engine)
  voyageAdapter,
  cohereAdapter,
  jinaAdapter,
  bgeAdapter,
];

const ADAPTERS_BY_KEY = new Map(ADAPTERS.map((adapter) => [adapter.key, adapter]));

export function getAdapter(key: IntegrationProviderKey): IntegrationAdapter {
  const adapter = ADAPTERS_BY_KEY.get(key);
  if (!adapter) throw new Error(`No integration adapter registered for "${key}".`);
  return adapter;
}

export function listAdapters(): IntegrationAdapter[] {
  return ADAPTERS;
}
