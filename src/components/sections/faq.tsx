import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Container } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";
import { buildFaqPageJsonLd } from "@/lib/seo/json-ld";

interface FAQItem {
  question: string;
  answer: string;
}

const FAQS: FAQItem[] = [
  {
    question: "What does GrowthOS actually automate?",
    answer:
      "GrowthOS runs five specialized AI agents that handle lead qualification, outbound email and LinkedIn sequencing, proposal and quote drafting, campaign content, and daily pipeline prioritization. Reps stay in the loop on every deal — the agents handle the repetitive, time-sensitive work around it.",
  },
  {
    question: "How does it integrate with our existing CRM, email, and LinkedIn?",
    answer:
      "GrowthOS syncs with HubSpot, Salesforce, and Pipedrive so activity, notes, and deal stages stay current without manual entry. Outreach runs through your connected email accounts and LinkedIn, so messages send from real sender identities your prospects already recognize.",
  },
  {
    question: "What happens to our data? Is anything used to train external models?",
    answer:
      "Your leads, messages, and pipeline data are used only to run your workspace. We don't sell customer data or use it to train models outside your account. Data is encrypted in transit and at rest, and access is restricted on a need-to-know basis.",
  },
  {
    question: "How does pricing work?",
    answer:
      "There's no public price list or self-serve plan to pick from. Talk to our team, tell us about your pipeline and lead volume, and we'll scope an agreement around your specific workflow and support needs.",
  },
  {
    question: "How long does onboarding take?",
    answer:
      "Most teams are sending their first AI-assisted sequences within a few days of connecting their CRM and email accounts. Full workflow customization — proposal templates, qualification criteria, escalation rules — typically wraps up within the first two to three weeks.",
  },
  {
    question: "Does this replace our sales reps?",
    answer:
      "No. GrowthOS is built to augment reps, not replace them — it clears the busywork of follow-up, research, and drafting so reps spend more time actually talking to qualified prospects and closing deals. Every agent action is visible and reversible by your team.",
  },
  {
    question: "Can we control what the AI agents are allowed to say or do?",
    answer:
      "Yes. You set the guardrails: approved messaging tone and templates, qualification thresholds, discount limits on proposals, and which actions require human approval before anything goes out to a prospect.",
  },
  {
    question: "What if we want to cancel?",
    answer:
      "You can cancel at any time — reach out to your account contact and we'll wind things down under the terms we agreed on.",
  },
];

function FAQ() {
  const jsonLd = buildFaqPageJsonLd(FAQS);

  return (
    <section className="relative py-24 sm:py-32">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <Container className="flex flex-col items-center gap-14">
        <SectionHeading
          eyebrow="FAQ"
          title="Frequently asked questions"
          description="Everything you need to know before rolling out GrowthOS to your team."
        />

        <Accordion
          type="single"
          defaultValue="item-0"
          className="w-full max-w-3xl"
        >
          {FAQS.map((item, index) => (
            <AccordionItem key={item.question} value={`item-${index}`}>
              <AccordionTrigger>{item.question}</AccordionTrigger>
              <AccordionContent>{item.answer}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </Container>
    </section>
  );
}

export default FAQ;
export { FAQ };
