"use client";

import { useRef, useState, useTransition } from "react";
import { FileText, Upload, Trash2, CheckCircle2, AlertTriangle } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { uploadCareerResume, deleteCareerResumeVersion } from "../../../_lib/career-resume-actions";
import { applyResumeFieldsToProfile } from "../../../_lib/career-profile-actions";

export interface CareerResumeView {
  id: string;
  version: number;
  originalFilename: string;
  status: string;
  failureReason: string | null;
  aiConfidence: string | null;
  aiExtractedProfile: Record<string, unknown> | null;
  userVerifiedFields: Record<string, boolean> | null;
  uploadedAt: string;
}

const APPLICABLE_FIELDS = [
  { key: "currentRole", label: "Current role" },
  { key: "careerLevel", label: "Career level" },
  { key: "yearsOfExperience", label: "Years of experience" },
  { key: "location", label: "Location" },
  { key: "industries", label: "Industries" },
  { key: "skills", label: "Skills" },
  { key: "education", label: "Education" },
  { key: "certifications", label: "Certifications" },
  { key: "projects", label: "Projects" },
  { key: "githubUrl", label: "GitHub" },
  { key: "linkedinUrl", label: "LinkedIn" },
  { key: "websiteUrl", label: "Website" },
  { key: "portfolioUrl", label: "Portfolio" },
] as const;

const STATUS_LABEL: Record<string, string> = {
  UPLOADED: "Uploaded",
  VALIDATING: "Validating",
  VALID: "Valid",
  INVALID: "Invalid",
  PARSING: "Extracting text…",
  PARSED: "Text extracted",
  AI_PROCESSING: "AI reviewing…",
  PROCESSED: "Processed",
  REVIEW_REQUIRED: "Ready for your review",
  VERIFIED: "Verified",
  FAILED: "Failed",
};

export function ResumePanel({ careerProfileId, resumes }: { careerProfileId: string; resumes: CareerResumeView[] }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isPending, startTransition] = useTransition();
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [selectedFields, setSelectedFields] = useState<Record<string, Set<string>>>({});

  function toggleField(resumeId: string, field: string) {
    setSelectedFields((prev) => {
      const set = new Set(prev[resumeId] ?? []);
      if (set.has(field)) set.delete(field);
      else set.add(field);
      return { ...prev, [resumeId]: set };
    });
  }

  return (
    <Card glass>
      <CardContent className="flex flex-col gap-4 p-5">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-foreground">Resume</p>
          <label className="flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium text-foreground transition-colors hover:bg-accent">
            <Upload className="size-3.5" /> {isPending ? "Uploading…" : "Upload new version"}
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,.txt"
              className="hidden"
              disabled={isPending}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setUploadError(null);
                startTransition(async () => {
                  const result = await uploadCareerResume(careerProfileId, file);
                  if (!result.ok) setUploadError(result.error ?? "Upload failed.");
                  else if (result.duplicateOfVersion) setUploadError(`This exact file was already uploaded as version ${result.duplicateOfVersion}.`);
                  if (fileInputRef.current) fileInputRef.current.value = "";
                });
              }}
            />
          </label>
        </div>
        <p className="text-xs text-muted-foreground">PDF, DOCX or TXT, up to 20MB. Every upload is a new version — nothing is overwritten.</p>
        {uploadError && <p className="text-xs text-destructive">{uploadError}</p>}

        {resumes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No resume uploaded yet.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {resumes.map((resume) => {
              const extraction = resume.aiExtractedProfile;
              const verified = resume.userVerifiedFields ?? {};
              const selected = selectedFields[resume.id] ?? new Set<string>();

              return (
                <div key={resume.id} className="rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <FileText className="size-4 text-muted-foreground" />
                      <span className="text-sm font-medium text-foreground">v{resume.version} — {resume.originalFilename}</span>
                      <Badge variant={resume.status === "VERIFIED" ? "default" : "outline"} className={resume.status === "FAILED" ? "border-destructive/40 text-destructive" : undefined}>
                        {STATUS_LABEL[resume.status] ?? resume.status}
                      </Badge>
                      {resume.aiConfidence && <Badge variant="secondary">AI confidence: {resume.aiConfidence}</Badge>}
                    </div>
                    <button
                      type="button"
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive"
                      onClick={() =>
                        startTransition(() => {
                          void deleteCareerResumeVersion(careerProfileId, resume.id);
                        })
                      }
                    >
                      <Trash2 className="size-3.5" /> Delete version
                    </button>
                  </div>

                  {resume.failureReason && (
                    <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {resume.failureReason}
                    </p>
                  )}

                  {extraction && (
                    <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
                      <p className="text-xs font-medium text-foreground">
                        AI extraction — review and apply what&apos;s accurate. Nothing here overwrites your profile until you apply it.
                      </p>
                      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                        {APPLICABLE_FIELDS.filter((f) => {
                          const value = extraction[f.key];
                          return value !== null && value !== undefined && (Array.isArray(value) ? value.length > 0 : true);
                        }).map((f) => (
                          <label key={f.key} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <input
                              type="checkbox"
                              checked={selected.has(f.key)}
                              onChange={() => toggleField(resume.id, f.key)}
                              className="size-3.5"
                            />
                            {f.label}
                            {verified[f.key] && <CheckCircle2 className="size-3 text-emerald-500" />}
                          </label>
                        ))}
                      </div>
                      <button
                        type="button"
                        disabled={selected.size === 0 || isPending}
                        className="mt-1 w-fit rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                        onClick={() =>
                          startTransition(() => {
                            void applyResumeFieldsToProfile(careerProfileId, resume.id, Array.from(selected));
                          })
                        }
                      >
                        Apply selected fields to profile
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
