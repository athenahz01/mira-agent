"use client";

import { Loader2, Plus, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  generateMediaKitDraft,
  renderMediaKitPdf,
  saveMediaKitEdits,
  upsertPastBrandWork,
} from "@/app/actions/media-kit";
import { MediaKitPreview } from "@/components/media-kit/media-kit-preview";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  mediaKitJsonSchema,
  type MediaKitJson,
  type PastBrandWorkInput,
} from "@/lib/db/media-kit";
import type { Tables } from "@/lib/db/types";
import type { MediaKitPageProfile } from "@/lib/media-kit/service";

type LocalProfile = MediaKitPageProfile;

export function KitsClient({
  initialProfiles,
}: {
  initialProfiles: LocalProfile[];
}) {
  const [profiles, setProfiles] = useState(initialProfiles);

  function updateProfile(profileId: string, patch: Partial<LocalProfile>) {
    setProfiles((current) =>
      current.map((profile) =>
        profile.profile.id === profileId ? { ...profile, ...patch } : profile,
      ),
    );
  }

  return (
    <main className="min-h-screen bg-muted/30 px-6 py-10">
      <section className="mx-auto grid w-full max-w-6xl gap-6">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Mira</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-normal">
            Media Kits
          </h1>
        </div>

        {profiles.map((profile) => (
          <KitSection
            key={profile.profile.id}
            onUpdate={(patch) => updateProfile(profile.profile.id, patch)}
            profile={profile}
          />
        ))}
      </section>
    </main>
  );
}

function KitSection({
  profile,
  onUpdate,
}: {
  profile: LocalProfile;
  onUpdate: (patch: Partial<LocalProfile>) => void;
}) {
  const [pastBrandWork, setPastBrandWork] = useState<PastBrandWorkInput[]>(
    profile.pastBrandWork.map((work) => ({
      brand_name: work.brand_name,
      year: work.year,
      deal_type: work.deal_type as PastBrandWorkInput["deal_type"],
      one_liner: work.one_liner,
      link: work.link ?? undefined,
    })),
  );
  const [isGenerating, startGenerating] = useTransition();
  const [isRendering, startRendering] = useTransition();
  const [isSavingJson, startSavingJson] = useTransition();
  const [jsonDraft, setJsonDraft] = useState(
    profile.activeKitJson ? JSON.stringify(profile.activeKitJson, null, 2) : "",
  );
  const [isEditingJson, setIsEditingJson] = useState(false);

  function onGenerate() {
    startGenerating(async () => {
      const saveWork = await upsertPastBrandWork(
        profile.profile.id,
        pastBrandWork,
      );

      if (!saveWork.ok) {
        toast.error(saveWork.error);
        return;
      }

      const result = await generateMediaKitDraft(
        profile.profile.id,
        pastBrandWork,
      );

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      const parsed = mediaKitJsonSchema.safeParse(result.data.data_json);

      if (!parsed.success) {
        toast.error("Mira generated a media kit, but the JSON was invalid.");
        return;
      }

      setJsonDraft(JSON.stringify(parsed.data, null, 2));
      onUpdate({
        activeKit: result.data,
        activeKitJson: parsed.data,
        pastBrandWork: saveWork.data,
      });
      toast.success(result.message);
    });
  }

  function onDownloadPdf() {
    if (!profile.activeKit) {
      toast.error("Generate a media kit first.");
      return;
    }

    startRendering(async () => {
      const result = await renderMediaKitPdf(profile.activeKit?.id ?? "");

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      onUpdate({
        activeKit: result.data.kit,
      });
      window.location.href = result.data.signedUrl;
      toast.success(result.message);
    });
  }

  function onSaveJson() {
    if (!profile.activeKit) {
      toast.error("Generate a media kit first.");
      return;
    }

    const parsed = parseKitJson(jsonDraft);

    if (!parsed.ok) {
      toast.error(parsed.error);
      return;
    }

    startSavingJson(async () => {
      const result = await saveMediaKitEdits(profile.activeKit?.id ?? "", parsed.data);

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      onUpdate({
        activeKit: result.data,
        activeKitJson: parsed.data,
      });
      setIsEditingJson(false);
      toast.success(result.message);
    });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>@{profile.profile.handle}</CardTitle>
            <CardDescription>
              {profile.activeKit ? `Media kit v${profile.activeKit.version}` : "No kit yet"}
            </CardDescription>
          </div>
          {profile.activeKit ? (
            <Badge>v{profile.activeKit.version} active</Badge>
          ) : (
            <Badge variant="outline">No kit</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="grid gap-6">
        <PastBrandWorkEditor
          entries={pastBrandWork}
          onChange={setPastBrandWork}
        />

        <div className="flex flex-wrap gap-3">
          <Button disabled={isGenerating} onClick={onGenerate} type="button">
            {isGenerating ? <Loader2 className="animate-spin" /> : null}
            {profile.activeKit ? "Regenerate" : "Generate kit"}
          </Button>
          <Button
            disabled={!profile.activeKit || isRendering}
            onClick={onDownloadPdf}
            type="button"
            variant="outline"
          >
            {isRendering ? <Loader2 className="animate-spin" /> : null}
            Download PDF
          </Button>
          <Button
            disabled={!profile.activeKitJson}
            onClick={() => setIsEditingJson((current) => !current)}
            type="button"
            variant="outline"
          >
            Edit JSON
          </Button>
        </div>

        {profile.activeKitJson ? (
          <MediaKitPreview kit={profile.activeKitJson} />
        ) : null}

        {isEditingJson ? (
          <div className="grid gap-3">
            <Label>Media kit JSON</Label>
            <Textarea
              className="min-h-96 font-mono text-xs"
              onChange={(event) => setJsonDraft(event.target.value)}
              value={jsonDraft}
            />
            <Button
              className="w-fit"
              disabled={isSavingJson}
              onClick={onSaveJson}
              type="button"
            >
              {isSavingJson ? <Loader2 className="animate-spin" /> : null}
              Save JSON edits
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function PastBrandWorkEditor({
  entries,
  onChange,
}: {
  entries: PastBrandWorkInput[];
  onChange: (entries: PastBrandWorkInput[]) => void;
}) {
  function updateEntry(index: number, patch: Partial<PastBrandWorkInput>) {
    onChange(
      entries.map((entry, entryIndex) =>
        entryIndex === index ? { ...entry, ...patch } : entry,
      ),
    );
  }

  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">Past brand work</h3>
          <p className="text-sm text-muted-foreground">
            Leave this empty and Mira will skip the section.
          </p>
        </div>
        <Button
          onClick={() =>
            onChange([
              ...entries,
              {
                brand_name: "",
                year: new Date().getFullYear(),
                deal_type: "ugc",
                one_liner: "",
              },
            ])
          }
          size="sm"
          type="button"
          variant="outline"
        >
          <Plus />
          Add
        </Button>
      </div>
      {entries.map((entry, index) => (
        <div className="grid gap-3 rounded-md border p-3" key={index}>
          <div className="grid gap-3 md:grid-cols-4">
            <Input
              onChange={(event) =>
                updateEntry(index, { brand_name: event.target.value })
              }
              placeholder="Brand"
              value={entry.brand_name}
            />
            <Input
              onChange={(event) =>
                updateEntry(index, { year: Number(event.target.value) })
              }
              type="number"
              value={entry.year}
            />
            <select
              className="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
              onChange={(event) =>
                updateEntry(index, {
                  deal_type: event.target
                    .value as PastBrandWorkInput["deal_type"],
                })
              }
              value={entry.deal_type}
            >
              {["paid", "gifting", "affiliate", "ugc", "ambassador"].map(
                (dealType) => (
                  <option key={dealType} value={dealType}>
                    {dealType}
                  </option>
                ),
              )}
            </select>
            <Button
              onClick={() =>
                onChange(entries.filter((_, entryIndex) => entryIndex !== index))
              }
              type="button"
              variant="outline"
            >
              <Trash2 />
              Remove
            </Button>
          </div>
          <Input
            onChange={(event) =>
              updateEntry(index, { one_liner: event.target.value })
            }
            placeholder="Created 3 UGC videos for a launch campaign"
            value={entry.one_liner}
          />
          <Input
            onChange={(event) =>
              updateEntry(index, {
                link: event.target.value || undefined,
              })
            }
            placeholder="Optional link"
            value={entry.link ?? ""}
          />
        </div>
      ))}
    </div>
  );
}

function parseKitJson(raw: string) {
  try {
    return {
      ok: true as const,
      data: mediaKitJsonSchema.parse(JSON.parse(raw)),
    };
  } catch (error) {
    return {
      ok: false as const,
      error:
        error instanceof Error
          ? error.message
          : "The edited media kit is not valid JSON.",
    };
  }
}
