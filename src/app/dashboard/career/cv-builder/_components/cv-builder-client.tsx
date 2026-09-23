"use client";

import { useMemo, useState, useTransition } from "react";
import { Download, Languages, Plus, Trash2, FileEdit, Loader2 } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { FormField } from "@/components/ui/form-field";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/toast";
import { CV_LANGUAGES, cvLanguageLabel, type CVContent } from "@/lib/validations/career-cv";
import {
  createCVAction,
  updateCVAction,
  deleteCVAction,
  generateCVPdfAction,
  translateCVAction,
  prefillCVFromProfileAction,
} from "../../_lib/cv-builder-actions";

type CVTemplateKey = "CLASSIC" | "MODERN" | "MINIMAL";

const TEMPLATES: { value: CVTemplateKey; label: string; description: string }[] = [
  { value: "CLASSIC", label: "Classic", description: "Traditional single column — ATS-friendly." },
  { value: "MODERN", label: "Modern", description: "Two-column with a dark sidebar for contact/skills." },
  { value: "MINIMAL", label: "Minimal", description: "Clean, generous whitespace, understated dividers." },
];

const EMPTY_CONTENT: CVContent = {
  personal: { fullName: "", headline: "", email: "", phone: "", location: "", links: [] },
  summary: "",
  experience: [],
  education: [],
  skills: [],
  certifications: [],
  languagesSpoken: [],
  projects: [],
};

export interface CVListItem {
  id: string;
  title: string;
  language: string;
  templateKey: CVTemplateKey;
  content: unknown;
  storageKey: string | null;
  generatedAt: string | null;
  translatedFromId: string | null;
  updatedAt: string;
}

export function CVBuilderClient({
  careerProfileId,
  profiles,
  initialCVs,
}: {
  careerProfileId: string;
  profiles: { id: string; name: string }[];
  initialCVs: CVListItem[];
}) {
  const [cvs, setCvs] = useState(initialCVs);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [title, setTitle] = useState("");
  const [language, setLanguage] = useState<string>("en");
  const [templateKey, setTemplateKey] = useState<CVTemplateKey>("CLASSIC");
  const [content, setContent] = useState<CVContent>(EMPTY_CONTENT);
  const [saving, startSaving] = useTransition();
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [generating, startGenerating] = useTransition();
  const [translatingId, setTranslatingId] = useState<string | null>(null);
  const [translating, startTranslating] = useTransition();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleting, startDeleting] = useTransition();
  const [translateLanguage, setTranslateLanguage] = useState<Record<string, string>>({});

  const editing = useMemo(() => cvs.find((c) => c.id === editingId) ?? null, [cvs, editingId]);

  function openNew(prefill: CVContent) {
    setIsNew(true);
    setEditingId(null);
    setTitle("New CV");
    setLanguage("en");
    setTemplateKey("CLASSIC");
    setContent(prefill);
  }

  function openEdit(cv: CVListItem) {
    setIsNew(false);
    setEditingId(cv.id);
    setTitle(cv.title);
    setLanguage(cv.language);
    setTemplateKey(cv.templateKey);
    setContent((cv.content as CVContent) ?? EMPTY_CONTENT);
  }

  function closeEditor() {
    setIsNew(false);
    setEditingId(null);
  }

  function handleStartFromScratch() {
    openNew(EMPTY_CONTENT);
  }

  function handleStartFromProfile() {
    startSaving(async () => {
      const result = await prefillCVFromProfileAction(careerProfileId);
      if (!result.ok || !result.content) {
        toast.error(result.error ?? "Could not load your profile data.");
        openNew(EMPTY_CONTENT);
        return;
      }
      openNew(result.content as CVContent);
    });
  }

  function handleSave() {
    startSaving(async () => {
      if (isNew) {
        const result = await createCVAction({ careerProfileId, title, language, templateKey, content });
        if (!result.ok) {
          toast.error(result.error ?? "Could not create this CV.");
          return;
        }
        toast.success("CV created.");
        window.location.reload();
        return;
      }
      if (!editingId) return;
      const result = await updateCVAction(careerProfileId, editingId, { title, language, templateKey, content });
      if (!result.ok) {
        toast.error(result.error ?? "Could not save this CV.");
        return;
      }
      toast.success("CV saved.");
      window.location.reload();
    });
  }

  function handleGenerate(cvId: string) {
    setGeneratingId(cvId);
    startGenerating(async () => {
      const result = await generateCVPdfAction(careerProfileId, cvId);
      setGeneratingId(null);
      if (!result.ok) {
        toast.error(result.error ?? "Could not generate the PDF.");
        return;
      }
      toast.success("PDF generated.");
      window.open(`/api/career/cv/${cvId}`, "_blank");
      window.location.reload();
    });
  }

  function handleTranslate(cvId: string) {
    const target = translateLanguage[cvId] ?? "es";
    setTranslatingId(cvId);
    startTranslating(async () => {
      const result = await translateCVAction(careerProfileId, cvId, { targetLanguage: target });
      setTranslatingId(null);
      if (!result.ok) {
        toast.error(result.error ?? "Translation failed.");
        return;
      }
      toast.success(`Translated to ${cvLanguageLabel(target)}.`);
      window.location.reload();
    });
  }

  function handleDelete(cvId: string) {
    if (!confirm("Delete this CV? This can't be undone.")) return;
    setDeletingId(cvId);
    startDeleting(async () => {
      const result = await deleteCVAction(careerProfileId, cvId);
      setDeletingId(null);
      if (!result.ok) {
        toast.error(result.error ?? "Could not delete this CV.");
        return;
      }
      setCvs((prev) => prev.filter((c) => c.id !== cvId));
      toast.success("CV deleted.");
    });
  }

  if (isNew || editing) {
    return (
      <CVEditor
        title={title}
        setTitle={setTitle}
        language={language}
        setLanguage={setLanguage}
        templateKey={templateKey}
        setTemplateKey={setTemplateKey}
        content={content}
        setContent={setContent}
        onCancel={closeEditor}
        onSave={handleSave}
        saving={saving}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {profiles.length > 1 && (
        <p className="text-xs text-muted-foreground">
          Showing CVs for <b>{profiles.find((p) => p.id === careerProfileId)?.name}</b>.
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        <Button type="button" onClick={handleStartFromScratch} disabled={saving}>
          <Plus className="size-4" /> New CV
        </Button>
        <Button type="button" variant="outline" onClick={handleStartFromProfile} disabled={saving}>
          {saving ? <Loader2 className="size-4 animate-spin" /> : <FileEdit className="size-4" />} Start from my profile
        </Button>
      </div>

      {cvs.length === 0 ? (
        <Card glass>
          <CardContent className="p-10 text-center text-sm text-muted-foreground">
            No CVs yet — create one from scratch or pre-fill from your career profile.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {cvs.map((cv) => (
            <Card glass key={cv.id}>
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <CardTitle className="text-base">{cv.title}</CardTitle>
                    <CardDescription>
                      {TEMPLATES.find((t) => t.value === cv.templateKey)?.label} &middot; {cvLanguageLabel(cv.language)}
                      {cv.translatedFromId && " · AI-translated"}
                    </CardDescription>
                  </div>
                  <Badge variant={cv.storageKey ? "accent" : "outline"}>{cv.storageKey ? "PDF ready" : "Not generated"}</Badge>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={() => openEdit(cv)}>
                    <FileEdit className="size-3.5" /> Edit
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => handleGenerate(cv.id)}
                    disabled={generating && generatingId === cv.id}
                  >
                    {generating && generatingId === cv.id ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
                    {cv.storageKey ? "Re-generate & download" : "Generate PDF"}
                  </Button>
                  {cv.storageKey && (
                    <Button type="button" size="sm" variant="ghost" onClick={() => window.open(`/api/career/cv/${cv.id}`, "_blank")}>
                      <Download className="size-3.5" /> Download
                    </Button>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="text-red-500 hover:bg-red-500/10"
                    onClick={() => handleDelete(cv.id)}
                    disabled={deleting && deletingId === cv.id}
                  >
                    <Trash2 className="size-3.5" /> Delete
                  </Button>
                </div>
                <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
                  <Languages className="size-3.5 text-muted-foreground" />
                  <Select
                    className="h-9 w-40"
                    value={translateLanguage[cv.id] ?? "es"}
                    onChange={(e) => setTranslateLanguage((prev) => ({ ...prev, [cv.id]: e.target.value }))}
                  >
                    {CV_LANGUAGES.filter((l) => l.code !== cv.language).map((l) => (
                      <option key={l.code} value={l.code}>
                        {l.label}
                      </option>
                    ))}
                  </Select>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => handleTranslate(cv.id)}
                    disabled={translating && translatingId === cv.id}
                  >
                    {translating && translatingId === cv.id ? <Loader2 className="size-3.5 animate-spin" /> : "Translate"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function CVEditor({
  title,
  setTitle,
  language,
  setLanguage,
  templateKey,
  setTemplateKey,
  content,
  setContent,
  onCancel,
  onSave,
  saving,
}: {
  title: string;
  setTitle: (v: string) => void;
  language: string;
  setLanguage: (v: string) => void;
  templateKey: CVTemplateKey;
  setTemplateKey: (v: CVTemplateKey) => void;
  content: CVContent;
  setContent: (v: CVContent) => void;
  onCancel: () => void;
  onSave: () => void;
  saving: boolean;
}) {
  function patch(partial: Partial<CVContent>) {
    setContent({ ...content, ...partial });
  }

  return (
    <div className="flex flex-col gap-6">
      <Card glass>
        <CardContent className="flex flex-wrap gap-4 p-6">
          <FormField label="CV title" htmlFor="cvTitle" className="min-w-[220px] flex-1">
            <Input id="cvTitle" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Software Engineer — English" />
          </FormField>
          <FormField label="Language" htmlFor="cvLanguage" className="w-48">
            <Select id="cvLanguage" value={language} onChange={(e) => setLanguage(e.target.value)}>
              {CV_LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Template" htmlFor="cvTemplate" className="w-48">
            <Select id="cvTemplate" value={templateKey} onChange={(e) => setTemplateKey(e.target.value as CVTemplateKey)}>
              {TEMPLATES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          </FormField>
        </CardContent>
      </Card>

      <Card glass>
        <CardHeader>
          <CardTitle className="text-base">Personal Info</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Full name" htmlFor="pFullName">
            <Input id="pFullName" value={content.personal.fullName} onChange={(e) => patch({ personal: { ...content.personal, fullName: e.target.value } })} />
          </FormField>
          <FormField label="Headline" htmlFor="pHeadline">
            <Input id="pHeadline" value={content.personal.headline} onChange={(e) => patch({ personal: { ...content.personal, headline: e.target.value } })} placeholder="e.g. Senior Backend Engineer" />
          </FormField>
          <FormField label="Email" htmlFor="pEmail">
            <Input id="pEmail" value={content.personal.email} onChange={(e) => patch({ personal: { ...content.personal, email: e.target.value } })} />
          </FormField>
          <FormField label="Phone" htmlFor="pPhone">
            <Input id="pPhone" value={content.personal.phone} onChange={(e) => patch({ personal: { ...content.personal, phone: e.target.value } })} />
          </FormField>
          <FormField label="Location" htmlFor="pLocation">
            <Input id="pLocation" value={content.personal.location} onChange={(e) => patch({ personal: { ...content.personal, location: e.target.value } })} />
          </FormField>
        </CardContent>
      </Card>

      <Card glass>
        <CardHeader>
          <CardTitle className="text-base">Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea rows={4} value={content.summary} onChange={(e) => patch({ summary: e.target.value })} placeholder="A short professional summary." />
        </CardContent>
      </Card>

      <RepeatableSection
        title="Experience"
        items={content.experience}
        onChange={(items) => patch({ experience: items })}
        emptyItem={{ company: "", role: "", location: "", startDate: "", endDate: "", current: false, bullets: [] }}
        renderItem={(item, update) => (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Input placeholder="Role" value={item.role} onChange={(e) => update({ ...item, role: e.target.value })} />
              <Input placeholder="Company" value={item.company} onChange={(e) => update({ ...item, company: e.target.value })} />
              <Input placeholder="Location" value={item.location} onChange={(e) => update({ ...item, location: e.target.value })} />
              <div className="flex gap-2">
                <Input placeholder="Start (e.g. Jan 2022)" value={item.startDate} onChange={(e) => update({ ...item, startDate: e.target.value })} />
                <Input placeholder="End" value={item.endDate} disabled={item.current} onChange={(e) => update({ ...item, endDate: e.target.value })} />
              </div>
            </div>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={item.current} onChange={(e) => update({ ...item, current: e.target.checked })} /> Currently working here
            </label>
            <Textarea
              rows={3}
              placeholder="One bullet point per line."
              value={item.bullets.join("\n")}
              onChange={(e) => update({ ...item, bullets: e.target.value.split("\n") })}
            />
          </div>
        )}
      />

      <RepeatableSection
        title="Education"
        items={content.education}
        onChange={(items) => patch({ education: items })}
        emptyItem={{ institution: "", degree: "", field: "", startDate: "", endDate: "", notes: "" }}
        renderItem={(item, update) => (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input placeholder="Institution" value={item.institution} onChange={(e) => update({ ...item, institution: e.target.value })} />
            <Input placeholder="Degree" value={item.degree} onChange={(e) => update({ ...item, degree: e.target.value })} />
            <Input placeholder="Field of study" value={item.field} onChange={(e) => update({ ...item, field: e.target.value })} />
            <div className="flex gap-2">
              <Input placeholder="Start" value={item.startDate} onChange={(e) => update({ ...item, startDate: e.target.value })} />
              <Input placeholder="End" value={item.endDate} onChange={(e) => update({ ...item, endDate: e.target.value })} />
            </div>
          </div>
        )}
      />

      <Card glass>
        <CardHeader>
          <CardTitle className="text-base">Skills</CardTitle>
          <CardDescription>Comma-separated.</CardDescription>
        </CardHeader>
        <CardContent>
          <Input
            value={content.skills.join(", ")}
            onChange={(e) => patch({ skills: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
            placeholder="e.g. TypeScript, PostgreSQL, System Design"
          />
        </CardContent>
      </Card>

      <RepeatableSection
        title="Certifications"
        items={content.certifications}
        onChange={(items) => patch({ certifications: items })}
        emptyItem={{ name: "", issuer: "", date: "" }}
        renderItem={(item, update) => (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Input placeholder="Name" value={item.name} onChange={(e) => update({ ...item, name: e.target.value })} />
            <Input placeholder="Issuer" value={item.issuer} onChange={(e) => update({ ...item, issuer: e.target.value })} />
            <Input placeholder="Date" value={item.date} onChange={(e) => update({ ...item, date: e.target.value })} />
          </div>
        )}
      />

      <RepeatableSection
        title="Projects"
        items={content.projects}
        onChange={(items) => patch({ projects: items })}
        emptyItem={{ name: "", description: "", url: "" }}
        renderItem={(item, update) => (
          <div className="flex flex-col gap-3">
            <Input placeholder="Project name" value={item.name} onChange={(e) => update({ ...item, name: e.target.value })} />
            <Textarea rows={2} placeholder="Description" value={item.description} onChange={(e) => update({ ...item, description: e.target.value })} />
          </div>
        )}
      />

      <RepeatableSection
        title="Languages spoken"
        items={content.languagesSpoken}
        onChange={(items) => patch({ languagesSpoken: items })}
        emptyItem={{ name: "", proficiency: "" }}
        renderItem={(item, update) => (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input placeholder="Language (e.g. Hindi)" value={item.name} onChange={(e) => update({ ...item, name: e.target.value })} />
            <Input placeholder="Proficiency (e.g. Native)" value={item.proficiency} onChange={(e) => update({ ...item, proficiency: e.target.value })} />
          </div>
        )}
      />

      <div className="sticky bottom-4 flex justify-end gap-3 rounded-lg border border-border bg-background/95 p-3 backdrop-blur">
        <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button type="button" onClick={onSave} disabled={saving || !content.personal.fullName.trim()}>
          {saving ? <Loader2 className="size-4 animate-spin" /> : null} Save CV
        </Button>
      </div>
    </div>
  );
}

function RepeatableSection<T>({
  title,
  items,
  onChange,
  emptyItem,
  renderItem,
}: {
  title: string;
  items: T[];
  onChange: (items: T[]) => void;
  emptyItem: T;
  renderItem: (item: T, update: (next: T) => void) => React.ReactNode;
}) {
  return (
    <Card glass>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{title}</CardTitle>
          <Button type="button" size="sm" variant="outline" onClick={() => onChange([...items, emptyItem])}>
            <Plus className="size-3.5" /> Add
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {items.length === 0 && <p className="text-sm text-muted-foreground">None added yet.</p>}
        {items.map((item, i) => (
          <div key={i} className="flex flex-col gap-2 rounded-lg border border-border p-4">
            {renderItem(item, (next) => onChange(items.map((it, idx) => (idx === i ? next : it))))}
            <Button type="button" size="sm" variant="ghost" className="w-fit text-red-500 hover:bg-red-500/10" onClick={() => onChange(items.filter((_, idx) => idx !== i))}>
              <Trash2 className="size-3.5" /> Remove
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
