import { Badge } from "@/components/ui/badge";
import type { MediaKitJson } from "@/lib/db/media-kit";

type MediaKitPreviewProps = {
  kit: MediaKitJson;
};

export function MediaKitPreview({ kit }: MediaKitPreviewProps) {
  const pastBrandWork = kit.past_brand_work.filter(Boolean);

  return (
    <article className="overflow-hidden rounded-md border bg-background">
      <section className="border-b bg-muted/40 px-6 py-8">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Media Kit
        </p>
        <h2 className="mt-3 text-3xl font-semibold tracking-normal">
          {kit.profile_summary.display_name}
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          {kit.profile_summary.tagline}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Badge variant="secondary">{kit.profile_summary.location}</Badge>
          {kit.profile_summary.languages.map((language) => (
            <Badge key={language} variant="outline">
              {language}
            </Badge>
          ))}
        </div>
      </section>

      <section className="grid gap-3 px-6 py-5 md:grid-cols-3">
        <Stat label="Platform" value={kit.audience.platform} />
        <Stat
          label="Followers"
          value={kit.audience.follower_count.toLocaleString()}
        />
        <Stat
          label="Engagement"
          value={`${(kit.audience.engagement_rate * 100).toFixed(1)}%`}
        />
      </section>

      <section className="grid gap-5 border-t px-6 py-6">
        <div>
          <h3 className="text-lg font-semibold">Niche</h3>
          <div className="mt-3 flex flex-wrap gap-2">
            {[
              ...kit.niche.categories,
              ...kit.niche.aesthetic_keywords,
            ].map((item) => (
              <Badge key={item} variant="secondary">
                {item}
              </Badge>
            ))}
          </div>
        </div>
        <div>
          <h3 className="text-lg font-semibold">Content pillars</h3>
          <div className="mt-3 grid gap-2 md:grid-cols-3">
            {kit.niche.content_pillars.map((pillar) => (
              <div className="rounded-md border px-3 py-3 text-sm" key={pillar}>
                {pillar}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="grid gap-4 border-t px-6 py-6">
        <h3 className="text-lg font-semibold">Deliverables</h3>
        <div className="grid gap-3 md:grid-cols-2">
          {kit.deliverables.map((deliverable) => (
            <div className="rounded-md border px-4 py-4" key={deliverable.kind}>
              <div className="flex items-start justify-between gap-3">
                <h4 className="font-medium">{formatKind(deliverable.kind)}</h4>
                <Badge variant="outline">
                  ${deliverable.suggested_rate_usd.min.toLocaleString()}-$
                  {deliverable.suggested_rate_usd.max.toLocaleString()}
                </Badge>
              </div>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {deliverable.description}
              </p>
              <p className="mt-3 text-xs text-muted-foreground">
                {deliverable.usage_rights_included} |{" "}
                {deliverable.typical_turnaround_days} day turnaround
              </p>
            </div>
          ))}
        </div>
      </section>

      {pastBrandWork.length > 0 ? (
        <section className="grid gap-3 border-t px-6 py-6">
          <h3 className="text-lg font-semibold">Past brand work</h3>
          {pastBrandWork.map((work) => (
            <div
              className="rounded-md border px-4 py-3"
              key={`${work.brand_name}-${work.year}`}
            >
              <p className="font-medium">
                {work.brand_name} | {work.year}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {work.one_liner}
              </p>
            </div>
          ))}
        </section>
      ) : null}

      <section className="grid gap-2 border-t px-6 py-6 text-sm text-muted-foreground">
        <h3 className="text-lg font-semibold text-foreground">Contact</h3>
        <p>{kit.contact.email}</p>
        <p>{kit.contact.instagram}</p>
        {kit.contact.website ? <p>{kit.contact.website}</p> : null}
        <p className="pt-2 text-xs">{kit.rate_methodology_note}</p>
      </section>
    </article>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border px-4 py-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-2 text-xl font-semibold">{value}</p>
    </div>
  );
}

function formatKind(kind: string) {
  return kind
    .split("_")
    .map((part) => part.toUpperCase())
    .join(" ");
}
