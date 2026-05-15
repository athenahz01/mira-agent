"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Check, Loader2 } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import {
  addVoiceSamples,
  completeOnboarding,
  generateVoiceGuide,
  saveCompetitorHandles,
  saveVoiceGuideEdits,
  upsertCreatorProfile,
  upsertUserBasics,
} from "@/app/actions/onboarding";
import { ChipInput } from "@/components/ui/chip-input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { voiceStyleGuideJsonSchema } from "@/lib/db/style-guide";
import type { VoiceStyleGuideJson } from "@/lib/db/style-guide";
import type { Tables } from "@/lib/db/types";
import {
  creatorProfileSchema,
  userBasicsSchema,
  type CreatorProfileInput,
  type UserBasicsInput,
  type VoiceSampleInput,
} from "@/lib/onboarding/schemas";

type OnboardingClientProps = {
  initialUser: Tables<"users"> | null;
  authDefaults: {
    name: string;
    timezone: string;
    physical_address: string;
    sender_display_name: string;
    email: string;
  };
  initialProfiles: Tables<"creator_profiles">[];
  initialActiveGuides: Record<string, Tables<"voice_style_guides">>;
  initialGuideJsonByProfileId: Record<string, VoiceStyleGuideJson>;
  voiceSampleCountsByProfileId: Record<string, number>;
  initialCompetitorHandlesByProfileId: Record<
    string,
    Tables<"competitor_handles">[]
  >;
  initialStep: number;
  profileFocus?: string;
};

const stepLabels = [
  "Account",
  "Profiles",
  "Samples",
  "Voice Guide",
  "Competitors",
  "Done",
] as const;

const voiceSamplesFormSchema = z.object({
  profiles: z.array(
    z.object({
      profileId: z.string().min(1),
      handle: z.string().min(1),
      active: z.boolean(),
      website: z.string().trim(),
      captions: z.array(z.string().trim()),
      pitches: z.array(
        z.object({
          text: z.string().trim(),
          source: z.enum(["email_sent", "manual_paste"]),
          tag: z.string().trim(),
        }),
      ),
    }),
  ),
});

type VoiceSamplesFormValues = z.infer<typeof voiceSamplesFormSchema>;

export function OnboardingClient({
  initialUser,
  authDefaults,
  initialProfiles,
  initialActiveGuides,
  initialGuideJsonByProfileId,
  voiceSampleCountsByProfileId,
  initialCompetitorHandlesByProfileId,
  initialStep,
  profileFocus,
}: OnboardingClientProps) {
  const [step, setStep] = useState(initialStep);
  const [profiles, setProfiles] = useState(initialProfiles);
  const [guides, setGuides] = useState(initialActiveGuides);
  const [guideJsonByProfileId, setGuideJsonByProfileId] = useState(
    initialGuideJsonByProfileId,
  );
  const [sampleCountsByProfileId, setSampleCountsByProfileId] = useState(
    voiceSampleCountsByProfileId,
  );
  const activeProfiles = profiles.filter((profile) => profile.active);
  const activeProfilesWithIds = activeProfiles.filter((profile) => profile.id);
  const canComplete =
    activeProfilesWithIds.length > 0 &&
    activeProfilesWithIds.every((profile) => guides[profile.id]);

  return (
    <main className="min-h-screen bg-muted/30 px-6 py-10">
      <section className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <div className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground">Mira</p>
          <h1 className="text-3xl font-semibold tracking-normal">
            Set up Mira&apos;s voice
          </h1>
        </div>

        <div className="flex flex-wrap gap-2">
          {stepLabels.map((label, index) => {
            const number = index + 1;
            return (
              <Button
                key={label}
                onClick={() => setStep(number)}
                size="sm"
                type="button"
                variant={step === number ? "default" : "outline"}
              >
                {number < step ? <Check /> : null}
                {label}
              </Button>
            );
          })}
        </div>

        {step === 1 ? (
          <AccountBasicsStep
            authDefaults={authDefaults}
            initialUser={initialUser}
            onSaved={() => setStep(2)}
          />
        ) : null}

        {step === 2 ? (
          <ProfilesStep
            onSaved={(profile) => {
              setProfiles((current) => {
                const existingIndex = current.findIndex(
                  (item) =>
                    item.id === profile.id || item.handle === profile.handle,
                );

                if (existingIndex === -1) {
                  return [...current, profile];
                }

                return current.map((item, index) =>
                  index === existingIndex ? profile : item,
                );
              });
            }}
            onStepComplete={() => setStep(3)}
            profiles={profiles}
          />
        ) : null}

        {step === 3 ? (
          <VoiceSamplesStep
            onSaved={(profileId, count) => {
              setSampleCountsByProfileId((current) => ({
                ...current,
                [profileId]: (current[profileId] ?? 0) + count,
              }));
            }}
            onStepComplete={() => setStep(4)}
            profileFocus={profileFocus}
            profiles={activeProfilesWithIds}
          />
        ) : null}

        {step === 4 ? (
          <VoiceGuideStep
            guideJsonByProfileId={guideJsonByProfileId}
            guides={guides}
            onGuideGenerated={(guide, json) => {
              setGuides((current) => ({
                ...current,
                [guide.creator_profile_id]: guide,
              }));
              setGuideJsonByProfileId((current) => ({
                ...current,
                [guide.creator_profile_id]: json,
              }));
            }}
            onStepComplete={() => setStep(5)}
            profiles={activeProfilesWithIds}
            sampleCountsByProfileId={sampleCountsByProfileId}
          />
        ) : null}

        {step === 5 ? (
          <CompetitorHandlesStep
            competitorHandlesByProfileId={initialCompetitorHandlesByProfileId}
            onStepComplete={() => setStep(6)}
            profiles={activeProfilesWithIds}
          />
        ) : null}

        {step === 6 ? (
          <DoneStep canComplete={canComplete} profiles={activeProfilesWithIds} />
        ) : null}
      </section>
    </main>
  );
}

function AccountBasicsStep({
  initialUser,
  authDefaults,
  onSaved,
}: {
  initialUser: Tables<"users"> | null;
  authDefaults: OnboardingClientProps["authDefaults"];
  onSaved: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const form = useForm<UserBasicsInput>({
    resolver: zodResolver(userBasicsSchema),
    defaultValues: {
      name: initialUser?.name ?? authDefaults.name,
      timezone: initialUser?.timezone ?? authDefaults.timezone,
      physical_address:
        initialUser?.physical_address ?? authDefaults.physical_address,
      sender_display_name:
        initialUser?.sender_display_name ?? authDefaults.sender_display_name,
    },
  });

  function onSubmit(values: UserBasicsInput) {
    startTransition(async () => {
      const result = await upsertUserBasics(values);

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      toast.success(result.message);
      onSaved();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Account basics</CardTitle>
        <CardDescription>
          This keeps Mira&apos;s sender identity and compliance footer ready.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form className="grid gap-5" onSubmit={form.handleSubmit(onSubmit)}>
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Display name</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="timezone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Timezone</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="physical_address"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Physical address</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Street, city, state, ZIP"
                      title="Cold outreach emails need a real mailing address in the footer for CAN-SPAM compliance."
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    Used only for the compliance footer in future outbound
                    emails.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="sender_display_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Sender display name</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormDescription>
                    This is the From name brands will see.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button className="w-fit" disabled={isPending} type="submit">
              {isPending ? <Loader2 className="animate-spin" /> : null}
              Save and continue
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}

function ProfilesStep({
  profiles,
  onSaved,
  onStepComplete,
}: {
  profiles: Tables<"creator_profiles">[];
  onSaved: (profile: Tables<"creator_profiles">) => void;
  onStepComplete: () => void;
}) {
  return (
    <div className="grid gap-5">
      {profiles.map((profile) => (
        <CreatorProfileCard
          key={profile.id || profile.handle}
          onSaved={onSaved}
          profile={profile}
        />
      ))}
      <Button className="w-fit" onClick={onStepComplete} type="button">
        Continue to samples
      </Button>
    </div>
  );
}

function CreatorProfileCard({
  profile,
  onSaved,
}: {
  profile: Tables<"creator_profiles">;
  onSaved: (profile: Tables<"creator_profiles">) => void;
}) {
  const [isPending, startTransition] = useTransition();
  const form = useForm<CreatorProfileInput>({
    resolver: zodResolver(creatorProfileSchema),
    defaultValues: {
      id: profile.id || undefined,
      handle: profile.handle,
      display_name: profile.display_name,
      platform: "instagram",
      tier: profile.tier as CreatorProfileInput["tier"],
      audience_size_snapshot: profile.audience_size_snapshot,
      engagement_rate_snapshot: profile.engagement_rate_snapshot,
      niche_tags: profile.niche_tags,
      aesthetic_keywords: profile.aesthetic_keywords,
      bio_extract: profile.bio_extract,
      recent_post_themes: profile.recent_post_themes,
      cross_pitch_cooldown_days: profile.cross_pitch_cooldown_days,
      active: profile.active,
    },
  });

  function onSubmit(values: CreatorProfileInput) {
    startTransition(async () => {
      const result = await upsertCreatorProfile(values);

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      toast.success(result.message);
      onSaved(result.data);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>@{profile.handle}</CardTitle>
        <CardDescription>
          Confirm the profile details Mira should use for fit and voice.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form className="grid gap-5" onSubmit={form.handleSubmit(onSubmit)}>
            <div className="grid gap-5 md:grid-cols-2">
              <FormField
                control={form.control}
                name="handle"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Handle</FormLabel>
                    <FormControl>
                      <Input disabled={Boolean(profile.id)} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="display_name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Display name</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="platform"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Platform</FormLabel>
                    <FormControl>
                      <select
                        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        {...field}
                      >
                        <option value="instagram">Instagram</option>
                      </select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="audience_size_snapshot"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Audience size</FormLabel>
                    <FormControl>
                      <Input
                        min={0}
                        onChange={(event) =>
                          field.onChange(
                            event.target.value
                              ? Number(event.target.value)
                              : null,
                          )
                        }
                        type="number"
                        value={field.value ?? ""}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="engagement_rate_snapshot"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Engagement rate</FormLabel>
                    <FormControl>
                      <Input
                        min={0}
                        onChange={(event) =>
                          field.onChange(
                            event.target.value
                              ? Number(event.target.value) / 100
                              : null,
                          )
                        }
                        step="0.01"
                        type="number"
                        value={
                          field.value === null || field.value === undefined
                            ? ""
                            : field.value * 100
                        }
                      />
                    </FormControl>
                    <FormDescription>Enter as a percent.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="cross_pitch_cooldown_days"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Cross-pitch cooldown</FormLabel>
                    <FormControl>
                      <Input
                        min={0}
                        onChange={(event) =>
                          field.onChange(Number(event.target.value))
                        }
                        type="number"
                        value={field.value}
                      />
                    </FormControl>
                    <FormDescription>
                      If Mira pitches a brand for one profile, she waits this
                      many days before pitching it from the other.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="tier"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tier</FormLabel>
                  <Tabs
                    onValueChange={(value) => field.onChange(value)}
                    value={field.value ?? "nano"}
                  >
                    <TabsList>
                      {["nano", "micro", "mid", "macro"].map((tier) => (
                        <TabsTrigger key={tier} type="button" value={tier}>
                          {tier}
                        </TabsTrigger>
                      ))}
                    </TabsList>
                  </Tabs>
                  <FormMessage />
                </FormItem>
              )}
            />
            <ArrayField
              control={form.control}
              name="niche_tags"
              placeholder="fashion, lifestyle, ugc"
              title="Niche tags"
            />
            <ArrayField
              control={form.control}
              name="aesthetic_keywords"
              placeholder="warm-toned, polished"
              title="Aesthetic keywords"
            />
            <FormField
              control={form.control}
              name="bio_extract"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Bio extract</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Paste the IG bio or write a 1-2 sentence positioning."
                      value={field.value ?? ""}
                      onChange={(event) =>
                        field.onChange(event.target.value || null)
                      }
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <ArrayField
              control={form.control}
              name="recent_post_themes"
              placeholder="fit checks, campus routines, ai tools"
              title="Recent post themes"
            />
            <FormField
              control={form.control}
              name="active"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center gap-3 space-y-0">
                  <FormControl>
                    <input
                      checked={field.value}
                      className="size-4 accent-primary"
                      onChange={(event) => field.onChange(event.target.checked)}
                      type="checkbox"
                    />
                  </FormControl>
                  <FormLabel>Active</FormLabel>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button className="w-fit" disabled={isPending} type="submit">
              {isPending ? <Loader2 className="animate-spin" /> : null}
              Save profile
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}

function ArrayField({
  control,
  name,
  title,
  placeholder,
}: {
  control: ReturnType<typeof useForm<CreatorProfileInput>>["control"];
  name: "niche_tags" | "aesthetic_keywords" | "recent_post_themes";
  title: string;
  placeholder: string;
}) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{title}</FormLabel>
          <FormControl>
            <ChipInput
              onChange={field.onChange}
              placeholder={placeholder}
              value={field.value}
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

function VoiceSamplesStep({
  profiles,
  profileFocus,
  onSaved,
  onStepComplete,
}: {
  profiles: Tables<"creator_profiles">[];
  profileFocus?: string;
  onSaved: (profileId: string, count: number) => void;
  onStepComplete: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const sortedProfiles = useMemo(() => {
    if (!profileFocus) {
      return profiles;
    }

    return [...profiles].sort((left, right) => {
      if (left.id === profileFocus || left.handle === profileFocus) {
        return -1;
      }

      if (right.id === profileFocus || right.handle === profileFocus) {
        return 1;
      }

      return 0;
    });
  }, [profileFocus, profiles]);
  const form = useForm<VoiceSamplesFormValues>({
    resolver: zodResolver(voiceSamplesFormSchema),
    defaultValues: {
      profiles: sortedProfiles.map((profile) => ({
        profileId: profile.id,
        handle: profile.handle,
        active: profile.active,
        website: "",
        captions: ["", "", ""],
        pitches: [
          {
            text: "",
            source: "email_sent",
            tag: "",
          },
          {
            text: "",
            source: "email_sent",
            tag: "",
          },
          {
            text: "",
            source: "manual_paste",
            tag: "",
          },
        ],
      })),
    },
  });
  const { fields } = useFieldArray({
    control: form.control,
    name: "profiles",
  });

  function onSubmit(values: VoiceSamplesFormValues) {
    const missingMinimum = values.profiles.find(
      (profile) =>
        profile.active &&
        (!profile.website.trim() ||
          profile.captions.filter((caption) => caption.trim()).length === 0),
    );

    if (missingMinimum) {
      toast.error(`Add website copy and one caption for @${missingMinimum.handle}.`);
      return;
    }

    startTransition(async () => {
      for (const profile of values.profiles) {
        const samples: VoiceSampleInput[] = [
          profile.website
            ? {
                source: "website",
                text: profile.website,
                tag: "website",
              }
            : null,
          ...profile.captions
            .filter(Boolean)
            .map((caption): VoiceSampleInput => ({
              source: "ig_caption",
              text: caption,
              tag: "caption",
            })),
          ...profile.pitches
            .filter((pitch) => pitch.text)
            .map((pitch): VoiceSampleInput => ({
              source: pitch.source,
              text: pitch.text,
              tag: pitch.tag || null,
            })),
        ].filter((sample): sample is VoiceSampleInput => sample !== null);

        if (samples.length === 0) {
          continue;
        }

        const result = await addVoiceSamples(profile.profileId, samples);

        if (!result.ok) {
          toast.error(result.error);
          return;
        }

        onSaved(profile.profileId, result.data.length);
      }

      toast.success("Voice samples saved.");
      onStepComplete();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Voice samples</CardTitle>
        <CardDescription>
          Add the writing Mira should learn from for each active profile.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form className="grid gap-6" onSubmit={form.handleSubmit(onSubmit)}>
            {fields.map((field, profileIndex) => (
              <div className="grid gap-4" key={field.id}>
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-lg font-semibold">@{field.handle}</h2>
                  <Badge variant="outline">active</Badge>
                </div>
                <FormField
                  control={form.control}
                  name={`profiles.${profileIndex}.website`}
                  render={({ field: formField }) => (
                    <FormItem>
                      <FormLabel>Website copy</FormLabel>
                      <FormControl>
                        <Textarea {...formField} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid gap-4 md:grid-cols-3">
                  {[0, 1, 2].map((captionIndex) => (
                    <FormField
                      control={form.control}
                      key={captionIndex}
                      name={`profiles.${profileIndex}.captions.${captionIndex}`}
                      render={({ field: formField }) => (
                        <FormItem>
                          <FormLabel>IG caption {captionIndex + 1}</FormLabel>
                          <FormControl>
                            <Textarea {...formField} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  ))}
                </div>
                <div className="grid gap-4 md:grid-cols-3">
                  {[0, 1, 2].map((pitchIndex) => (
                    <div className="grid gap-3" key={pitchIndex}>
                      <FormField
                        control={form.control}
                        name={`profiles.${profileIndex}.pitches.${pitchIndex}.text`}
                        render={({ field: formField }) => (
                          <FormItem>
                            <FormLabel>Pitch email {pitchIndex + 1}</FormLabel>
                            <FormControl>
                              <Textarea {...formField} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name={`profiles.${profileIndex}.pitches.${pitchIndex}.source`}
                        render={({ field: formField }) => (
                          <FormItem>
                            <FormLabel>Source</FormLabel>
                            <FormControl>
                              <select
                                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                {...formField}
                              >
                                <option value="email_sent">Sent email</option>
                                <option value="manual_paste">Manual paste</option>
                              </select>
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name={`profiles.${profileIndex}.pitches.${pitchIndex}.tag`}
                        render={({ field: formField }) => (
                          <FormItem>
                            <FormLabel>Tag</FormLabel>
                            <FormControl>
                              <Input placeholder="gifting, paid" {...formField} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
            <div className="flex flex-wrap gap-3">
              <Button disabled={isPending} type="submit">
                {isPending ? <Loader2 className="animate-spin" /> : null}
                Save samples
              </Button>
              <Button onClick={onStepComplete} type="button" variant="ghost">
                I&apos;ll add more later
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}

function VoiceGuideStep({
  profiles,
  guides,
  guideJsonByProfileId,
  sampleCountsByProfileId,
  onGuideGenerated,
  onStepComplete,
}: {
  profiles: Tables<"creator_profiles">[];
  guides: Record<string, Tables<"voice_style_guides">>;
  guideJsonByProfileId: Record<string, VoiceStyleGuideJson>;
  sampleCountsByProfileId: Record<string, number>;
  onGuideGenerated: (
    guide: Tables<"voice_style_guides">,
    json: VoiceStyleGuideJson,
  ) => void;
  onStepComplete: () => void;
}) {
  return (
    <div className="grid gap-5">
      {profiles.map((profile) => (
        <VoiceGuideCard
          guide={guides[profile.id]}
          guideJson={guideJsonByProfileId[profile.id]}
          key={profile.id}
          onGuideGenerated={onGuideGenerated}
          profile={profile}
          sampleCount={sampleCountsByProfileId[profile.id] ?? 0}
        />
      ))}
      <Button className="w-fit" onClick={onStepComplete} type="button">
        Continue
      </Button>
    </div>
  );
}

function VoiceGuideCard({
  profile,
  guide,
  guideJson,
  sampleCount,
  onGuideGenerated,
}: {
  profile: Tables<"creator_profiles">;
  guide?: Tables<"voice_style_guides">;
  guideJson?: VoiceStyleGuideJson;
  sampleCount: number;
  onGuideGenerated: (
    guide: Tables<"voice_style_guides">,
    json: VoiceStyleGuideJson,
  ) => void;
}) {
  const [isGenerating, startGenerating] = useTransition();
  const [isSaving, startSaving] = useTransition();
  const [isEditing, setIsEditing] = useState(false);
  const [draftJson, setDraftJson] = useState(
    guideJson ? JSON.stringify(guideJson, null, 2) : "",
  );

  function onGenerate() {
    startGenerating(async () => {
      const result = await generateVoiceGuide(profile.id);

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      const parsed = voiceStyleGuideJsonSchema.safeParse(
        result.data.style_doc_json,
      );

      if (!parsed.success) {
        toast.error("Mira generated a guide, but it did not match the schema.");
        return;
      }

      setDraftJson(JSON.stringify(parsed.data, null, 2));
      onGuideGenerated(result.data, parsed.data);
      toast.success(result.message);
    });
  }

  function onSaveEdits() {
    if (!guide) {
      toast.error("Generate a guide before editing.");
      return;
    }

    const parsedJson = parseJsonDraft(draftJson);

    if (!parsedJson.ok) {
      toast.error(parsedJson.error);
      return;
    }

    startSaving(async () => {
      const result = await saveVoiceGuideEdits(guide.id, parsedJson.data);

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      setIsEditing(false);
      onGuideGenerated(result.data, parsedJson.data);
      toast.success(result.message);
    });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>@{profile.handle}</CardTitle>
            <CardDescription>
              {sampleCount} sample{sampleCount === 1 ? "" : "s"} saved
            </CardDescription>
          </div>
          {guide ? <Badge>v{guide.version} active</Badge> : <Badge variant="outline">No guide</Badge>}
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        {guideJson ? <VoiceGuideSummary guide={guideJson} /> : null}
        {isEditing ? (
          <div className="grid gap-3">
            <Label>Editable guide JSON</Label>
            <Textarea
              className="min-h-96 font-mono text-xs"
              onChange={(event) => setDraftJson(event.target.value)}
              value={draftJson}
            />
          </div>
        ) : null}
        <div className="flex flex-wrap gap-3">
          <Button disabled={isGenerating} onClick={onGenerate} type="button">
            {isGenerating ? <Loader2 className="animate-spin" /> : null}
            {guide ? "Regenerate" : "Generate my voice guide"}
          </Button>
          {guide ? (
            <>
              <Button
                onClick={() => setIsEditing((current) => !current)}
                type="button"
                variant="outline"
              >
                Edit fields
              </Button>
              {isEditing ? (
                <Button disabled={isSaving} onClick={onSaveEdits} type="button">
                  {isSaving ? <Loader2 className="animate-spin" /> : null}
                  Save edits
                </Button>
              ) : null}
            </>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function VoiceGuideSummary({ guide }: { guide: VoiceStyleGuideJson }) {
  return (
    <div className="grid gap-4 text-sm">
      <div className="grid gap-1">
        <p className="font-medium">Register</p>
        <p className="text-muted-foreground">{guide.register.default}</p>
      </div>
      <div className="grid gap-2">
        <p className="font-medium">Avoid phrases</p>
        <div className="flex flex-wrap gap-2">
          {guide.avoid_phrases.map((phrase) => (
            <Badge key={phrase} variant="secondary">
              {phrase}
            </Badge>
          ))}
        </div>
      </div>
      <div className="grid gap-2">
        <p className="font-medium">Hook patterns</p>
        <ul className="grid gap-1 text-muted-foreground">
          {guide.hook_patterns.map((pattern) => (
            <li key={pattern}>{pattern}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function CompetitorHandlesStep({
  profiles,
  competitorHandlesByProfileId,
  onStepComplete,
}: {
  profiles: Tables<"creator_profiles">[];
  competitorHandlesByProfileId: Record<string, Tables<"competitor_handles">[]>;
  onStepComplete: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [handlesByProfileId, setHandlesByProfileId] = useState<
    Record<string, string[]>
  >(() =>
    Object.fromEntries(
      profiles.map((profile) => [
        profile.id,
        (competitorHandlesByProfileId[profile.id] ?? []).map(
          (handle) => handle.handle,
        ),
      ]),
    ),
  );

  function save() {
    startTransition(async () => {
      const result = await saveCompetitorHandles({
        profiles: profiles.map((profile) => ({
          profileId: profile.id,
          handles: handlesByProfileId[profile.id] ?? [],
        })),
      });

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      toast.success(result.message);
      onStepComplete();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Seed competitor handles</CardTitle>
        <CardDescription>
          Add creators in your niche or tier so Mira can discover brands from
          their sponsored posts.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        {profiles.map((profile) => (
          <div className="grid gap-2" key={profile.id}>
            <Label>@{profile.handle}</Label>
            <ChipInput
              onChange={(handles) =>
                setHandlesByProfileId((current) => ({
                  ...current,
                  [profile.id]: handles.map(normalizeHandle).filter(Boolean),
                }))
              }
              placeholder="creatorone, creatortwo"
              value={handlesByProfileId[profile.id] ?? []}
            />
            <p className="text-sm text-muted-foreground">
              Aim for 3-5 creators you already use as a reference point.
            </p>
          </div>
        ))}
        <div className="flex flex-wrap gap-3">
          <Button disabled={isPending} onClick={save} type="button">
            {isPending ? <Loader2 className="animate-spin" /> : null}
            Save handles
          </Button>
          <Button onClick={onStepComplete} type="button" variant="ghost">
            I&apos;ll add them later
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function DoneStep({
  profiles,
  canComplete,
}: {
  profiles: Tables<"creator_profiles">[];
  canComplete: boolean;
}) {
  const [isPending, startTransition] = useTransition();

  function onComplete() {
    startTransition(async () => {
      const result = await completeOnboarding();

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      toast.success(result.message);
      window.location.href = "/dashboard";
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Ready for the next phase</CardTitle>
        <CardDescription>
          {profiles.length} active profile{profiles.length === 1 ? "" : "s"}{" "}
          connected to Mira&apos;s voice system.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <Button disabled={!canComplete || isPending} onClick={onComplete}>
          {isPending ? <Loader2 className="animate-spin" /> : null}
          Finish onboarding
        </Button>
      </CardContent>
    </Card>
  );
}

function normalizeHandle(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/^instagram\.com\//, "")
    .replace(/[/#?].*$/, "")
    .replace(/^@/, "")
    .trim();
}

function parseJsonDraft(raw: string) {
  try {
    const parsed = voiceStyleGuideJsonSchema.parse(JSON.parse(raw));
    return {
      ok: true as const,
      data: parsed,
    };
  } catch (error) {
    return {
      ok: false as const,
      error:
        error instanceof Error
          ? error.message
          : "The edited guide is not valid JSON.",
    };
  }
}
