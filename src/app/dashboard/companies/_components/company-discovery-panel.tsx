import Link from "next/link";
import { Globe, Link2, Cpu, Gauge, ArrowUpRight, History } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TechnologyChipGrid } from "@/app/dashboard/website-scanner/_components/technology-chip-grid";
import type { Technology } from "@/generated/prisma/client";

export interface CompanyDiscoveryPanelProps {
  website: string | null;
  socialLinks: { linkedin?: string; facebook?: string; twitter?: string; instagram?: string };
  technologies: string[];
  latestScan: {
    id: string;
    scannedAt: string | null;
    seoScore: number | null;
    performanceScore: number | null;
    securityScore: number | null;
    uxScore: number | null;
    technologies: Technology[];
  } | null;
  sourceCount: number;
  discoverySources: string[];
  lastDiscoveredAt: string;
  createdAt: string;
}

const SCORES: Array<{ key: "seoScore" | "performanceScore" | "securityScore" | "uxScore"; label: string }> = [
  { key: "seoScore", label: "SEO" },
  { key: "performanceScore", label: "Performance" },
  { key: "securityScore", label: "Security" },
  { key: "uxScore", label: "UX" },
];

function scoreBadgeVariant(score: number | null): "outline" | "accent" | "secondary" {
  if (score == null) return "outline";
  if (score >= 70) return "accent";
  if (score >= 40) return "secondary";
  return "outline";
}

/** Digital Presence + Technology + Website Findings + discovery Sources — all NEW sections added to the company detail page, none of which existed before Phase 1's discovery-tracking fields. */
export function CompanyDiscoveryPanel({
  website,
  socialLinks,
  technologies,
  latestScan,
  sourceCount,
  discoverySources,
  lastDiscoveredAt,
  createdAt,
}: CompanyDiscoveryPanelProps) {
  const scanTechNames = new Set((latestScan?.technologies ?? []).map((t) => t.name.toLowerCase()));
  const extraTechnologies = technologies.filter((t) => !scanTechNames.has(t.toLowerCase()));

  return (
    <div className="flex flex-col gap-4">
      <Card glass>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Globe className="size-4" /> Digital presence
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 pt-0 text-sm">
          {website ? (
            <a href={website} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-primary hover:underline">
              <Globe className="size-3.5 shrink-0" /> {website}
            </a>
          ) : (
            <p className="text-muted-foreground">No website on file.</p>
          )}
          {(socialLinks.linkedin || socialLinks.facebook || socialLinks.twitter || socialLinks.instagram) ? (
            <div className="flex flex-wrap items-center gap-3">
              {socialLinks.linkedin && (
                <a href={socialLinks.linkedin} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary">
                  <Link2 className="size-3.5" /> LinkedIn
                </a>
              )}
              {socialLinks.facebook && (
                <a href={socialLinks.facebook} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary">
                  <Link2 className="size-3.5" /> Facebook
                </a>
              )}
              {socialLinks.twitter && (
                <a href={socialLinks.twitter} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary">
                  <Link2 className="size-3.5" /> Twitter / X
                </a>
              )}
              {socialLinks.instagram && (
                <a href={socialLinks.instagram} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary">
                  <Link2 className="size-3.5" /> Instagram
                </a>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">No social links on file.</p>
          )}
        </CardContent>
      </Card>

      <Card glass>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Cpu className="size-4" /> Technology
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 pt-0">
          {technologies.length === 0 ? (
            <p className="text-sm text-muted-foreground">No technologies recorded yet.</p>
          ) : (
            <>
              {latestScan && latestScan.technologies.length > 0 && (
                <TechnologyChipGrid technologies={latestScan.technologies} />
              )}
              {extraTechnologies.length > 0 && (
                <div>
                  {latestScan && latestScan.technologies.length > 0 && (
                    <p className="mb-1.5 text-xs font-semibold text-foreground">
                      Other recorded technologies (no scan-category evidence)
                    </p>
                  )}
                  <div className="flex flex-wrap gap-1.5">
                    {extraTechnologies.map((t) => (
                      <Badge key={t} variant="outline">
                        {t}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card glass>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Gauge className="size-4" /> Website findings
          </CardTitle>
          {latestScan && (
            <Link
              href={`/dashboard/website-scanner/${latestScan.id}`}
              className="flex items-center gap-1 text-xs text-primary hover:underline"
            >
              View full scan <ArrowUpRight className="size-3.5" />
            </Link>
          )}
        </CardHeader>
        <CardContent className="pt-0">
          {!latestScan ? (
            <p className="text-sm text-muted-foreground">
              No website scan has been run for this company yet. Run one from Website Scanner to populate SEO,
              performance, security, and UX findings here.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap gap-2">
                {SCORES.map(({ key, label }) => {
                  const value = latestScan[key];
                  return (
                    <Badge key={key} variant={scoreBadgeVariant(value)}>
                      {label}: {value == null ? "—" : `${value}/100`}
                    </Badge>
                  );
                })}
              </div>
              {latestScan.scannedAt && (
                <p className="text-xs text-muted-foreground">Last scanned {new Date(latestScan.scannedAt).toLocaleString()}</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card glass>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="size-4" /> Sources
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 pt-0 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Discovery count</span>
            <Badge variant={sourceCount > 1 ? "accent" : "outline"}>
              {sourceCount} source{sourceCount === 1 ? "" : "s"}
              {sourceCount > 1 ? " — possible duplicate" : ""}
            </Badge>
          </div>
          {discoverySources.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {discoverySources.map((s) => (
                <Badge key={s} variant="outline">
                  {s.replace(/_/g, " ")}
                </Badge>
              ))}
            </div>
          )}
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>First discovered</span>
            <span>{new Date(createdAt).toLocaleString()}</span>
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Last (re)discovered</span>
            <span>{new Date(lastDiscoveredAt).toLocaleString()}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
