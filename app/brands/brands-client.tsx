"use client";

import { Loader2, Pencil, Plus, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import type React from "react";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  addCompetitorHandle,
  addBrandContactManual,
  addBrandManual,
  addBrandsFromCsv,
  enrichBrandContacts,
  enrichUnenrichedBrands,
  enqueueAllCompetitorScrapes,
  enqueueBulkPageScrape,
  enqueueInstagramCompetitorScrape,
  enqueuePageScrapeForBrand,
  getBrandJobStatus,
  markContactUnreachable,
  removeCompetitorHandle,
  toggleBrandExcluded,
  updateBrand,
} from "@/app/actions/brands";
import { draftBrandManually } from "@/app/actions/drafting";
import { computeFitScoresForAllBrands } from "@/app/actions/scoring";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ChipInput } from "@/components/ui/chip-input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import type { Tables } from "@/lib/db/types";
import type {
  BrandListResult,
  BrandListRow,
  CsvImportResult,
} from "@/lib/brands/service";
import type { BulkEnrichmentResult } from "@/lib/enrichment/bulk";
import type { ContactDiscoveryResult } from "@/lib/enrichment/contacts";
import type {
  BulkPageScrapeEnqueueResult,
  PageScrapeJobSummary,
} from "@/lib/jobs/brand-page-scrape";
import type {
  BulkInstagramScrapeEnqueueResult,
  CompetitorScraperPanelData,
  InstagramScrapeJobSummary,
} from "@/lib/instagram/competitors";
import { DEAL_TYPES, type DealType } from "@/lib/scoring/rules";
import type { RankedBrandListResult, RankedBrandRow } from "@/lib/scoring/service";

type SizeInput =
  | "pre-launch"
  | "indie-small"
  | "indie-medium"
  | "established-dtc"
  | "legacy-large"
  | "unknown";

type BrandFormState = {
  name: string;
  domain: string;
  instagram_handle: string;
  tiktok_handle: string;
  category: string[];
  aesthetic_tags: string[];
  size_estimate: SizeInput;
  pays_creators: boolean | null;
  notes: string;
};

type BrandEditState = BrandFormState & {
  aliases: string[];
  excluded: boolean;
  exclusion_reason: string;
};

type ContactFormState = {
  email: string;
  name: string;
  role:
    | "pr"
    | "marketing"
    | "partnerships"
    | "founder"
    | "generic_info"
    | "unknown";
};

type FilterState = {
  query: string;
  categories: string[];
  size_estimate: SizeInput;
  has_contacts: boolean;
  excluded: boolean;
  sort: "created_at" | "name";
  direction: "asc" | "desc";
};

const categorySuggestions = [
  "skincare",
  "beauty",
  "fashion",
  "accessories",
  "jewelry",
  "home",
  "fragrance",
  "supplements",
  "foodbev",
  "fitness",
  "tech",
  "edtech",
];

const sizeOptions: SizeInput[] = [
  "unknown",
  "pre-launch",
  "indie-small",
  "indie-medium",
  "established-dtc",
  "legacy-large",
];

const emptyBrandForm: BrandFormState = {
  name: "",
  domain: "",
  instagram_handle: "",
  tiktok_handle: "",
  category: [],
  aesthetic_tags: [],
  size_estimate: "unknown",
  pays_creators: null,
  notes: "",
};

const emptyContactForm: ContactFormState = {
  email: "",
  name: "",
  role: "unknown",
};

export function BrandsClient({
  initialList,
  competitorScrapers,
  rankedList,
}: {
  initialList: BrandListResult;
  competitorScrapers: CompetitorScraperPanelData;
  rankedList: RankedBrandListResult | null;
}) {
  const router = useRouter();
  const [manualForm, setManualForm] = useState<BrandFormState>(emptyBrandForm);
  const [csvResult, setCsvResult] = useState<CsvImportResult | null>(null);
  const [bulkResult, setBulkResult] = useState<BulkEnrichmentResult | null>(
    null,
  );
  const [bulkScrapeResult, setBulkScrapeResult] =
    useState<BulkPageScrapeEnqueueResult | null>(null);
  const [instagramBulkResult, setInstagramBulkResult] =
    useState<BulkInstagramScrapeEnqueueResult | null>(null);
  const [competitorInputs, setCompetitorInputs] = useState<
    Record<string, string>
  >({});
  const [contactResult, setContactResult] =
    useState<ContactDiscoveryResult | null>(null);
  const [pageScrapeJob, setPageScrapeJob] =
    useState<PageScrapeJobSummary | null>(null);
  const [showSkippedRows, setShowSkippedRows] = useState(false);
  const [editingBrand, setEditingBrand] = useState<Tables<"brands"> | null>(
    null,
  );
  const [editForm, setEditForm] = useState<BrandEditState | null>(null);
  const [filters, setFilters] = useState<FilterState>({
    query: initialList.filters.query,
    categories: initialList.filters.categories,
    size_estimate: initialList.filters.size_estimate ?? "unknown",
    has_contacts: initialList.filters.has_contacts,
    excluded: initialList.filters.excluded,
    sort: initialList.filters.sort,
    direction: initialList.filters.direction,
  });
  const [isSaving, startSaving] = useTransition();
  const [isImporting, startImporting] = useTransition();
  const [isEnriching, startEnriching] = useTransition();
  const [isScraping, startScraping] = useTransition();
  const [isCompetitorPending, startCompetitorTransition] = useTransition();
  const [isScoring, startScoring] = useTransition();
  const [isDraftingPitch, startDraftingPitch] = useTransition();
  const [contactForm, setContactForm] =
    useState<ContactFormState>(emptyContactForm);
  const activeEditingBrand = editingBrand
    ? initialList.brands.find((brand) => brand.id === editingBrand.id) ??
      editingBrand
    : null;
  const activePageScrapeJob =
    pageScrapeJob ??
    ((activeEditingBrand as BrandListRow | null)?.page_scrape_job ?? null);

  useEffect(() => {
    if (
      !activeEditingBrand ||
      !activePageScrapeJob ||
      !["queued", "running"].includes(activePageScrapeJob.status)
    ) {
      return;
    }

    const interval = window.setInterval(async () => {
      const result = await getBrandJobStatus(activeEditingBrand.id);

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      setPageScrapeJob(result.data);

      if (
        result.data &&
        ["succeeded", "failed", "cancelled"].includes(result.data.status)
      ) {
        router.refresh();
      }
    }, 5_000);

    return () => window.clearInterval(interval);
  }, [activeEditingBrand, activePageScrapeJob, router]);

  function refreshBrands() {
    router.refresh();
  }

  function submitManualBrand(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startSaving(async () => {
      const result = await addBrandManual(toBrandInput(manualForm));

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      if (result.data.queued_for_review) {
        toast.info("Similar brand found. Review it in match proposals.");
      } else {
        toast.success(result.data.created ? "Brand created." : "Brand merged.");
        setManualForm(emptyBrandForm);
      }
      refreshBrands();
    });
  }

  function submitCsv(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const file = formData.get("csv");

    if (!(file instanceof File) || file.size === 0) {
      toast.error("Choose a CSV file first.");
      return;
    }

    startImporting(async () => {
      const result = await addBrandsFromCsv(await file.text());

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      setCsvResult(result.data);
      toast.success(result.message);
      refreshBrands();
    });
  }

  function openEdit(brand: BrandListRow) {
    setEditingBrand(brand);
    setContactResult(null);
    setPageScrapeJob(brand.page_scrape_job);
    setContactForm(emptyContactForm);
    setEditForm({
      name: brand.name,
      aliases: brand.aliases,
      domain: brand.domain ?? "",
      instagram_handle: brand.instagram_handle ?? "",
      tiktok_handle: brand.tiktok_handle ?? "",
      category: brand.category,
      aesthetic_tags: brand.aesthetic_tags,
      size_estimate: (brand.size_estimate as SizeInput | null) ?? "unknown",
      pays_creators: brand.pays_creators,
      notes: brand.source_signals_summary ?? "",
      excluded: brand.excluded,
      exclusion_reason: brand.exclusion_reason ?? "",
    });
  }

  function enrichOneBrand() {
    if (!activeEditingBrand) {
      return;
    }

    startEnriching(async () => {
      const result = await enrichBrandContacts(activeEditingBrand.id);

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      setContactResult(result.data);
      toast.success(contactResultLabel(result.data));
      refreshBrands();
    });
  }

  function enrichBulk() {
    startEnriching(async () => {
      const result = await enrichUnenrichedBrands();

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      setBulkResult(result.data);
      toast.success(result.message);
      refreshBrands();
    });
  }

  function scrapeOneBrand() {
    if (!activeEditingBrand) {
      return;
    }

    startScraping(async () => {
      const result = await enqueuePageScrapeForBrand(activeEditingBrand.id);

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      setPageScrapeJob(result.data);
      toast.success(result.message);
      refreshBrands();
    });
  }

  function scrapeBulk() {
    startScraping(async () => {
      const result = await enqueueBulkPageScrape();

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      setBulkScrapeResult(result.data);
      toast.success(result.message);
      refreshBrands();
    });
  }

  function submitCompetitorHandle(
    profileId: string,
    event: React.FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    const handle = competitorInputs[profileId] ?? "";

    startCompetitorTransition(async () => {
      const result = await addCompetitorHandle(profileId, handle);

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      setCompetitorInputs((current) => ({
        ...current,
        [profileId]: "",
      }));
      toast.success(result.message);
      refreshBrands();
    });
  }

  function scrapeCompetitor(competitorHandleId: string) {
    startCompetitorTransition(async () => {
      const result = await enqueueInstagramCompetitorScrape(competitorHandleId);

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      toast.success(result.message);
      refreshBrands();
    });
  }

  function scrapeAllCompetitors(profileId: string) {
    startCompetitorTransition(async () => {
      const result = await enqueueAllCompetitorScrapes(profileId);

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      setInstagramBulkResult(result.data);
      toast.success(result.message);
      refreshBrands();
    });
  }

  function deleteCompetitor(competitorHandleId: string) {
    startCompetitorTransition(async () => {
      const result = await removeCompetitorHandle(competitorHandleId);

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      toast.success(result.message);
      refreshBrands();
    });
  }

  function addManualContact(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!activeEditingBrand) {
      return;
    }

    startSaving(async () => {
      const result = await addBrandContactManual(
        activeEditingBrand.id,
        contactForm,
      );

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      setContactForm(emptyContactForm);
      toast.success(result.message);
      refreshBrands();
    });
  }

  function toggleUnreachable(contact: Tables<"brand_contacts">) {
    startSaving(async () => {
      const result = await markContactUnreachable(
        contact.id,
        !contact.marked_unreachable,
      );

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      toast.success(result.message);
      refreshBrands();
    });
  }

  function saveEdit() {
    if (!editingBrand || !editForm) {
      return;
    }

    startSaving(async () => {
      const result = await updateBrand(editingBrand.id, {
        ...toBrandInput(editForm),
        aliases: editForm.aliases,
        excluded: editForm.excluded,
        exclusion_reason: editForm.exclusion_reason || null,
      });

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      toast.success(result.message);
      setEditingBrand(null);
      setEditForm(null);
      refreshBrands();
    });
  }

  function toggleExcluded(brand: BrandListRow) {
    const nextExcluded = !brand.excluded;
    const reason = nextExcluded
      ? window.prompt("Why should Mira skip this brand?")
      : null;

    if (nextExcluded && reason === null) {
      return;
    }

    startSaving(async () => {
      const result = await toggleBrandExcluded(brand.id, nextExcluded, reason);

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      toast.success(result.message);
      refreshBrands();
    });
  }

  function applyFilters(nextFilters = filters, page = 1) {
    const params = new URLSearchParams();

    if (nextFilters.query) {
      params.set("query", nextFilters.query);
    }

    for (const category of nextFilters.categories) {
      params.append("category", category);
    }

    if (nextFilters.size_estimate !== "unknown") {
      params.set("size_estimate", nextFilters.size_estimate);
    }

    if (nextFilters.has_contacts) {
      params.set("has_contacts", "true");
    }

    if (nextFilters.excluded) {
      params.set("excluded", "true");
    }

    params.set("sort", nextFilters.sort);
    params.set("direction", nextFilters.direction);
    params.set("page", String(page));
    if (rankedList) {
      params.set("view", rankedList.dealType);

      if (rankedList.creatorProfileId) {
        params.set("profile", rankedList.creatorProfileId);
      }
    }
    router.push(`/brands?${params.toString()}`);
  }

  function switchView(view: "all" | DealType, profileId?: string | null) {
    const params = new URLSearchParams();

    if (view !== "all") {
      const nextProfileId =
        profileId ??
        rankedList?.creatorProfileId ??
        competitorScrapers.profiles[0]?.id ??
        null;

      params.set("view", view);

      if (nextProfileId) {
        params.set("profile", nextProfileId);
      }
    }

    router.push(`/brands?${params.toString()}`);
  }

  function recomputeScores() {
    startScoring(async () => {
      const result = await computeFitScoresForAllBrands();

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      toast.success(
        `${result.data.scores_written} scores written, ${result.data.scores_cached} cached.`,
      );
      refreshBrands();
    });
  }

  function draftRankedPitch(row: RankedBrandRow) {
    startDraftingPitch(async () => {
      const result = await draftBrandManually(
        row.score.creator_profile_id,
        row.brand.id,
        row.score.deal_type as DealType,
      );

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      toast.success("Draft created.");
      router.push(`/approvals?focus=${result.data.message.id}`);
    });
  }

  return (
    <main className="min-h-screen bg-muted/30 px-6 py-10">
      <section className="mx-auto grid w-full max-w-7xl gap-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-muted-foreground">Mira</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-normal">
              Brand Pool
            </h1>
          </div>
          <Button asChild variant="outline">
            <a href="/dashboard">Dashboard</a>
          </Button>
          <Button asChild variant="outline">
            <a href="/brands/proposals">
              Match proposals
              {initialList.openMatchProposalCount > 0 ? (
                <Badge variant="secondary">
                  {initialList.openMatchProposalCount}
                </Badge>
              ) : null}
            </a>
          </Button>
        </div>

        <details className="order-3 rounded-lg border bg-background p-4">
          <summary className="cursor-pointer text-sm font-medium">
            Add manually
          </summary>
          <div className="mt-4 grid gap-6 xl:grid-cols-3">
            <Card>
            <CardHeader>
              <CardTitle>Add a brand</CardTitle>
              <CardDescription>
                Mira will merge exact identity matches instead of duplicating
                them.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <BrandForm
                form={manualForm}
                isSaving={isSaving}
                onChange={setManualForm}
                onSubmit={submitManualBrand}
                submitLabel="Add brand"
              />
            </CardContent>
            </Card>

            <Card>
            <CardHeader>
              <CardTitle>Bulk enrich</CardTitle>
              <CardDescription>
                {initialList.unenrichedHunterCount} brands with domains have no
                Hunter enrichment yet.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <Button disabled={isEnriching} onClick={enrichBulk} type="button">
                {isEnriching ? <Loader2 className="animate-spin" /> : null}
                Enrich up to 25 with Hunter
              </Button>
              {bulkResult ? (
                <div className="rounded-md border bg-background p-3 text-sm">
                  <p className="font-medium">
                    {bulkResult.processed} processed, {bulkResult.succeeded}{" "}
                    succeeded, {bulkResult.skipped} skipped,{" "}
                    {bulkResult.errors.length} errors
                  </p>
                </div>
              ) : null}
              <div className="border-t pt-4">
                <Button
                  disabled={isScraping}
                  onClick={scrapeBulk}
                  type="button"
                  variant="outline"
                >
                  {isScraping ? <Loader2 className="animate-spin" /> : null}
                  Scrape contact pages for all
                </Button>
                {bulkScrapeResult ? (
                  <p className="mt-3 text-sm text-muted-foreground">
                    {bulkScrapeResult.enqueued} scrape jobs queued.
                  </p>
                ) : null}
              </div>
            </CardContent>
            </Card>

            <Card>
            <CardHeader>
              <CardTitle>Bulk import from CSV</CardTitle>
              <CardDescription>
                Up to 500 rows. Categories and aesthetic tags use semicolons.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className="grid gap-4" onSubmit={submitCsv}>
                <div className="grid gap-2">
                  <Label htmlFor="csv">CSV file</Label>
                  <Input accept=".csv,text/csv" id="csv" name="csv" type="file" />
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <Button disabled={isImporting} type="submit">
                    {isImporting ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <Upload />
                    )}
                    Import CSV
                  </Button>
                  <Button asChild type="button" variant="outline">
                    <a href="/brands/template">Download template</a>
                  </Button>
                </div>
              </form>
              {csvResult ? (
                <div className="mt-5 rounded-md border bg-background p-4 text-sm">
                  <p className="font-medium">
                    {csvResult.created} created, {csvResult.merged} merged,{" "}
                    {csvResult.queued_for_review} queued for review,{" "}
                    {csvResult.skipped.length} skipped
                  </p>
                  {csvResult.skipped.length > 0 ? (
                    <div className="mt-3">
                      <Button
                        onClick={() =>
                          setShowSkippedRows((current) => !current)
                        }
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        {showSkippedRows ? "Hide" : "Show"} skipped rows
                      </Button>
                      {showSkippedRows ? (
                        <div className="mt-3 grid gap-2">
                          {csvResult.skipped.map((row) => (
                            <p key={`${row.row_number}-${row.reason}`}>
                              Row {row.row_number}: {row.reason}
                            </p>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </CardContent>
            </Card>
          </div>
        </details>

        <div className="order-1">
          <CompetitorScrapersPanel
            data={competitorScrapers}
            inputs={competitorInputs}
            isPending={isCompetitorPending}
            onAdd={submitCompetitorHandle}
            onChangeInput={(profileId, value) =>
              setCompetitorInputs((current) => ({
                ...current,
                [profileId]: value,
              }))
            }
            onRemove={deleteCompetitor}
            onScrapeAll={scrapeAllCompetitors}
            onScrapeOne={scrapeCompetitor}
            result={instagramBulkResult}
          />
        </div>

        <Card className="order-2">
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <CardTitle>
                  {rankedList ? `Ranked: ${rankedList.dealType}` : "Brands"}
                </CardTitle>
                <CardDescription>
                  {rankedList
                    ? `${rankedList.total} scored brand${rankedList.total === 1 ? "" : "s"}`
                    : `${initialList.total} matching brand${
                        initialList.total === 1 ? "" : "s"
                      }`}
                </CardDescription>
              </div>
              {rankedList ? (
                <Button
                  disabled={isScoring}
                  onClick={recomputeScores}
                  type="button"
                  variant="outline"
                >
                  {isScoring ? <Loader2 className="animate-spin" /> : null}
                  Recompute scores
                </Button>
              ) : null}
            </div>
          </CardHeader>
          <CardContent className="grid gap-5">
            <RankedTabs
              activeDealType={rankedList?.dealType ?? null}
              activeProfileId={rankedList?.creatorProfileId ?? null}
              profiles={competitorScrapers.profiles}
              onSwitch={switchView}
            />
            {rankedList && competitorScrapers.profiles.length > 0 ? (
              <Field label="Creator profile">
                <select
                  className="h-9 w-fit rounded-md border border-input bg-background px-3 text-sm"
                  onChange={(event) =>
                    switchView(rankedList.dealType, event.target.value)
                  }
                  value={
                    rankedList.creatorProfileId ??
                    competitorScrapers.profiles[0]?.id ??
                    ""
                  }
                >
                  {competitorScrapers.profiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      @{profile.handle}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}
            <CardDescription>
              {rankedList && rankedList.total === 0
                ? "No scores yet. Click Recompute scores to rank this view."
                : null}
            </CardDescription>
            <FiltersBar
              categoryOptions={initialList.categoryOptions}
              filters={filters}
              onApply={(nextFilters) => applyFilters(nextFilters)}
              onChange={setFilters}
            />
            {rankedList ? (
              <>
                <RankedBrandGrid
                  isDrafting={isDraftingPitch}
                  onEdit={(row) => openEdit(row.brand)}
                  onDraft={draftRankedPitch}
                  rows={rankedList.rows}
                />
                <RankedPagination
                  list={rankedList}
                  onPage={(page) => applyFilters(filters, page)}
                />
              </>
            ) : (
              <>
                <BrandTable
                  brands={initialList.brands}
                  direction={initialList.filters.direction}
                  onEdit={openEdit}
                  onSort={(sort) => {
                    const nextDirection: "asc" | "desc" =
                      filters.sort === sort && filters.direction === "asc"
                        ? "desc"
                        : "asc";
                    const nextFilters = {
                      ...filters,
                      sort,
                      direction: nextDirection,
                    };
                    setFilters(nextFilters);
                    applyFilters(nextFilters);
                  }}
                  onToggleExcluded={toggleExcluded}
                  sort={initialList.filters.sort}
                />
                <Pagination
                  list={initialList}
                  onPage={(page) => applyFilters(filters, page)}
                />
              </>
            )}
          </CardContent>
        </Card>
      </section>

      <Dialog
        onOpenChange={(open) => {
          if (!open) {
            setEditingBrand(null);
            setEditForm(null);
          }
        }}
        open={Boolean(editingBrand)}
      >
        <DialogContent className="left-auto right-0 top-0 h-screen max-w-xl translate-x-0 translate-y-0 overflow-y-auto rounded-none sm:rounded-none">
          <DialogHeader>
            <DialogTitle>Edit brand</DialogTitle>
            <DialogDescription>
              Changes apply to the canonical brand row.
            </DialogDescription>
          </DialogHeader>
          {editForm ? (
            <div className="grid gap-6">
              <BrandForm
                form={editForm}
                includeAliases
                includeExclusion
                isSaving={isSaving}
                onChange={(nextForm) => setEditForm(nextForm as BrandEditState)}
                onSubmit={(event) => {
                  event.preventDefault();
                  saveEdit();
                }}
                submitLabel="Save changes"
              />
              {activeEditingBrand ? (
                <ContactsSection
                  brand={activeEditingBrand as BrandListRow}
                  contactForm={contactForm}
                  contactResult={contactResult}
                  isScraping={isScraping}
                  isEnriching={isEnriching}
                  isSaving={isSaving}
                  onAddContact={addManualContact}
                  onChangeContactForm={setContactForm}
                  onEnrich={enrichOneBrand}
                  onScrape={scrapeOneBrand}
                  onToggleUnreachable={toggleUnreachable}
                  pageScrapeJob={activePageScrapeJob}
                />
              ) : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </main>
  );
}

function CompetitorScrapersPanel({
  data,
  inputs,
  result,
  isPending,
  onAdd,
  onChangeInput,
  onRemove,
  onScrapeAll,
  onScrapeOne,
}: {
  data: CompetitorScraperPanelData;
  inputs: Record<string, string>;
  result: BulkInstagramScrapeEnqueueResult | null;
  isPending: boolean;
  onAdd: (
    profileId: string,
    event: React.FormEvent<HTMLFormElement>,
  ) => void;
  onChangeInput: (profileId: string, value: string) => void;
  onRemove: (competitorHandleId: string) => void;
  onScrapeAll: (profileId: string) => void;
  onScrapeOne: (competitorHandleId: string) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Discover brands</CardTitle>
        <CardDescription>
          Add creator accounts Athena studies, then Mira can pull sponsored
          brand tags from their recent posts.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        {data.profiles.map((profile) => {
          const handles = data.handles.filter(
            (handle) => handle.creator_profile_id === profile.id,
          );

          return (
            <div className="grid gap-3 rounded-md border p-4" key={profile.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium">@{profile.handle}</p>
                  <p className="text-sm text-muted-foreground">
                    {profile.display_name}
                  </p>
                </div>
                <Button
                  disabled={isPending || handles.length === 0}
                  onClick={() => onScrapeAll(profile.id)}
                  type="button"
                  variant="outline"
                >
                  {isPending ? <Loader2 className="animate-spin" /> : null}
                  Run all
                </Button>
              </div>

              <form
                className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]"
                onSubmit={(event) => onAdd(profile.id, event)}
              >
                <Input
                  onChange={(event) =>
                    onChangeInput(profile.id, event.target.value)
                  }
                  placeholder="@competitor or instagram.com/competitor"
                  value={inputs[profile.id] ?? ""}
                />
                <Button disabled={isPending} type="submit">
                  <Plus />
                  Add handle
                </Button>
              </form>

              <div className="grid gap-2">
                {handles.length === 0 ? (
                  <p className="rounded-md border bg-background p-3 text-sm text-muted-foreground">
                    No competitor handles yet.
                  </p>
                ) : (
                  handles.map((handle) => (
                    <div
                      className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-background p-3 text-sm"
                      key={handle.id}
                    >
                      <div>
                        <p className="font-medium">@{handle.handle}</p>
                        <p className="text-muted-foreground">
                          Last scraped:{" "}
                          {handle.last_scraped_at
                            ? new Date(
                                handle.last_scraped_at,
                              ).toLocaleDateString()
                            : "Never"}
                        </p>
                        {handle.latest_job ? (
                          <p className="text-muted-foreground">
                            {instagramJobLabel(handle.latest_job)}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          disabled={
                            isPending ||
                            Boolean(
                              handle.latest_job &&
                                ["queued", "running"].includes(
                                  handle.latest_job.status,
                                ),
                            )
                          }
                          onClick={() => onScrapeOne(handle.id)}
                          size="sm"
                          type="button"
                          variant="outline"
                        >
                          {isPending ? (
                            <Loader2 className="animate-spin" />
                          ) : null}
                          Scrape now
                        </Button>
                        <Button
                          disabled={isPending}
                          onClick={() => onRemove(handle.id)}
                          size="sm"
                          type="button"
                          variant="ghost"
                        >
                          Remove
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
        {result ? (
          <p className="rounded-md border bg-background p-3 text-sm text-muted-foreground">
            {result.enqueued} Instagram scrape jobs queued, {result.skipped}{" "}
            skipped.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function RankedTabs({
  activeDealType,
  activeProfileId,
  profiles,
  onSwitch,
}: {
  activeDealType: DealType | null;
  activeProfileId: string | null;
  profiles: CompetitorScraperPanelData["profiles"];
  onSwitch: (view: "all" | DealType, profileId?: string | null) => void;
}) {
  const profileId = activeProfileId ?? profiles[0]?.id ?? null;

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        onClick={() => onSwitch("all")}
        type="button"
        variant={activeDealType ? "outline" : "default"}
      >
        All brands
      </Button>
      {DEAL_TYPES.map((dealType) => (
        <Button
          key={dealType}
          onClick={() => onSwitch(dealType, profileId)}
          type="button"
          variant={activeDealType === dealType ? "default" : "outline"}
        >
          Ranked: {dealType}
        </Button>
      ))}
    </div>
  );
}

function RankedBrandGrid({
  rows,
  onEdit,
  onDraft,
  isDrafting,
}: {
  rows: RankedBrandRow[];
  onEdit: (row: RankedBrandRow) => void;
  onDraft: (row: RankedBrandRow) => void;
  isDrafting: boolean;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-md border bg-background p-8 text-center text-sm text-muted-foreground">
        No scored brands match this view.
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {rows.map((row) => (
        <Card key={row.score.id}>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <button
                className="text-left text-lg font-semibold"
                onClick={() => onEdit(row)}
                type="button"
              >
                {row.brand.name}
              </button>
              <Badge className={scoreBadgeClass(row.score.deal_type_score)}>
                {row.score.deal_type_score}
              </Badge>
            </div>
            <CardDescription>
              Base fit {row.score.base_fit_score} · {row.brand.contact_count}{" "}
              contact{row.brand.contact_count === 1 ? "" : "s"}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="flex flex-wrap gap-2">
              {row.brand.category.map((category) => (
                <Badge key={category} variant="secondary">
                  {category}
                </Badge>
              ))}
            </div>
            <details className="rounded-md border bg-muted/30 p-3 text-sm">
              <summary className="cursor-pointer font-medium">Why</summary>
              <div className="mt-3 grid gap-2 text-muted-foreground">
                {[...row.rationale.base_rationale, ...row.rationale.deal_type_rationale].map(
                  (line) => (
                    <p key={line}>{line}</p>
                  ),
                )}
              </div>
            </details>
            <Button
              disabled={isDrafting}
              onClick={() => onDraft(row)}
              type="button"
            >
              {isDrafting ? <Loader2 className="animate-spin" /> : null}
              Draft this pitch
            </Button>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function RankedPagination({
  list,
  onPage,
}: {
  list: RankedBrandListResult;
  onPage: (page: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
      <p>
        Page {list.page} of {list.totalPages}
      </p>
      <div className="flex gap-2">
        <Button
          disabled={list.page <= 1}
          onClick={() => onPage(list.page - 1)}
          size="sm"
          type="button"
          variant="outline"
        >
          Previous
        </Button>
        <Button
          disabled={list.page >= list.totalPages}
          onClick={() => onPage(list.page + 1)}
          size="sm"
          type="button"
          variant="outline"
        >
          Next
        </Button>
      </div>
    </div>
  );
}

function FiltersBar({
  filters,
  categoryOptions,
  onChange,
  onApply,
}: {
  filters: FilterState;
  categoryOptions: string[];
  onChange: (filters: FilterState) => void;
  onApply: (filters: FilterState) => void;
}) {
  function toggleCategory(category: string) {
    const nextCategories = filters.categories.includes(category)
      ? filters.categories.filter((item) => item !== category)
      : [...filters.categories, category];

    onChange({
      ...filters,
      categories: nextCategories,
    });
  }

  return (
    <div className="grid gap-4 rounded-md border bg-background p-4">
      <div className="grid gap-3 md:grid-cols-[minmax(0,1.4fr)_180px_160px]">
        <Field label="Search">
          <Input
            onChange={(event) =>
              onChange({ ...filters, query: event.target.value })
            }
            placeholder="Name, alias, domain, handle"
            value={filters.query}
          />
        </Field>
        <Field label="Size">
          <select
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            onChange={(event) =>
              onChange({
                ...filters,
                size_estimate: event.target.value as SizeInput,
              })
            }
            value={filters.size_estimate}
          >
            {sizeOptions.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </Field>
        <div className="flex items-end gap-3">
          <Toggle
            checked={filters.has_contacts}
            label="Has contacts"
            onChange={(value) => onChange({ ...filters, has_contacts: value })}
          />
          <Toggle
            checked={filters.excluded}
            label="Excluded"
            onChange={(value) => onChange({ ...filters, excluded: value })}
          />
        </div>
      </div>
      {categoryOptions.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {categoryOptions.map((category) => (
            <Button
              key={category}
              onClick={() => toggleCategory(category)}
              size="sm"
              type="button"
              variant={
                filters.categories.includes(category) ? "default" : "outline"
              }
            >
              {category}
            </Button>
          ))}
        </div>
      ) : null}
      <Button className="w-fit" onClick={() => onApply(filters)} type="button">
        Apply filters
      </Button>
    </div>
  );
}

function BrandTable({
  brands,
  sort,
  direction,
  onSort,
  onEdit,
  onToggleExcluded,
}: {
  brands: BrandListRow[];
  sort: "created_at" | "name";
  direction: "asc" | "desc";
  onSort: (sort: "created_at" | "name") => void;
  onEdit: (brand: BrandListRow) => void;
  onToggleExcluded: (brand: BrandListRow) => void;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>
            <button onClick={() => onSort("name")} type="button">
              Name {sort === "name" ? sortArrow(direction) : ""}
            </button>
          </TableHead>
          <TableHead>Categories</TableHead>
          <TableHead>Size</TableHead>
          <TableHead>IG</TableHead>
          <TableHead>Domain</TableHead>
          <TableHead>Contacts</TableHead>
          <TableHead>Pitched?</TableHead>
          <TableHead>Excluded</TableHead>
          <TableHead>
            <button onClick={() => onSort("created_at")} type="button">
              Added {sort === "created_at" ? sortArrow(direction) : ""}
            </button>
          </TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {brands.length === 0 ? (
          <TableRow>
            <TableCell className="py-10 text-center text-muted-foreground" colSpan={10}>
              No brands match these filters.
            </TableCell>
          </TableRow>
        ) : (
          brands.map((brand) => (
            <TableRow key={brand.id}>
              <TableCell>
                <div title={brand.aliases.join(", ") || undefined}>
                  <p className="font-medium">{brand.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {brand.identity_key}
                  </p>
                </div>
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-1">
                  {brand.category.map((category) => (
                    <Badge key={category} variant="secondary">
                      {category}
                    </Badge>
                  ))}
                </div>
              </TableCell>
              <TableCell>{brand.size_estimate ?? "unknown"}</TableCell>
              <TableCell>
                {brand.instagram_handle ? `@${brand.instagram_handle}` : "None"}
              </TableCell>
              <TableCell>{brand.domain ?? "None"}</TableCell>
              <TableCell>
                {brand.contact_count > 0 ? (
                  <Badge variant="secondary">{brand.contact_count}</Badge>
                ) : (
                  "None"
                )}
              </TableCell>
              <TableCell>
                {brand.last_pitched_at
                  ? new Date(brand.last_pitched_at).toLocaleDateString()
                  : "Not yet"}
              </TableCell>
              <TableCell>
                <Button
                  onClick={() => onToggleExcluded(brand)}
                  size="sm"
                  type="button"
                  variant={brand.excluded ? "default" : "outline"}
                >
                  {brand.excluded ? "Excluded" : "Active"}
                </Button>
              </TableCell>
              <TableCell>
                {new Date(brand.created_at).toLocaleDateString()}
              </TableCell>
              <TableCell>
                <Button
                  onClick={() => onEdit(brand)}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <Pencil />
                  Edit
                </Button>
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}

function ContactsSection({
  brand,
  contactForm,
  contactResult,
  isEnriching,
  isScraping,
  isSaving,
  onAddContact,
  onChangeContactForm,
  onEnrich,
  onScrape,
  onToggleUnreachable,
  pageScrapeJob,
}: {
  brand: BrandListRow;
  contactForm: ContactFormState;
  contactResult: ContactDiscoveryResult | null;
  isEnriching: boolean;
  isScraping: boolean;
  isSaving: boolean;
  onAddContact: (event: React.FormEvent<HTMLFormElement>) => void;
  onChangeContactForm: (form: ContactFormState) => void;
  onEnrich: () => void;
  onScrape: () => void;
  onToggleUnreachable: (contact: Tables<"brand_contacts">) => void;
  pageScrapeJob: PageScrapeJobSummary | null;
}) {
  const scrapeDisabled =
    isScraping ||
    !brand.domain ||
    Boolean(
      pageScrapeJob && ["queued", "running"].includes(pageScrapeJob.status),
    );

  return (
    <section className="grid gap-4 border-t pt-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">Contacts</h3>
          <p className="text-sm text-muted-foreground">
            Hunter results are sorted by confidence, with manual contacts kept
            here too.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={isEnriching || !brand.domain}
            onClick={onEnrich}
            type="button"
            variant="outline"
          >
            {isEnriching ? <Loader2 className="animate-spin" /> : null}
            Find contacts
          </Button>
          <Button
            disabled={scrapeDisabled}
            onClick={onScrape}
            type="button"
            variant="outline"
          >
            {isScraping ? <Loader2 className="animate-spin" /> : null}
            Scrape contact pages
          </Button>
        </div>
      </div>

      {contactResult ? (
        <div className="rounded-md border bg-muted/30 p-3 text-sm">
          {contactResultLabel(contactResult)}
        </div>
      ) : null}

      {pageScrapeJob ? (
        <div className="rounded-md border bg-muted/30 p-3 text-sm">
          {pageScrapeJobLabel(pageScrapeJob)}
        </div>
      ) : null}

      <div className="grid gap-2">
        {brand.contacts.length === 0 ? (
          <p className="rounded-md border p-3 text-sm text-muted-foreground">
            No contacts yet.
          </p>
        ) : (
          brand.contacts.map((contact) => (
            <div
              className="grid gap-3 rounded-md border p-3 text-sm"
              key={contact.id}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p
                    className={
                      contact.marked_unreachable ? "line-through" : undefined
                    }
                  >
                    {contact.email}
                  </p>
                  {contact.name ? (
                    <p className="text-muted-foreground">{contact.name}</p>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">{contact.role ?? "unknown"}</Badge>
                  <Badge variant={confidenceVariant(contact.confidence)}>
                    {confidenceLabel(contact.confidence)}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {contact.source}
                  </span>
                </div>
              </div>
              <Toggle
                checked={contact.marked_unreachable}
                label="Mark unreachable"
                onChange={() => onToggleUnreachable(contact)}
              />
            </div>
          ))
        )}
      </div>

      <form className="grid gap-3 rounded-md border p-3" onSubmit={onAddContact}>
        <p className="text-sm font-medium">Add contact manually</p>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Email">
            <Input
              onChange={(event) =>
                onChangeContactForm({
                  ...contactForm,
                  email: event.target.value,
                })
              }
              required
              type="email"
              value={contactForm.email}
            />
          </Field>
          <Field label="Name">
            <Input
              onChange={(event) =>
                onChangeContactForm({
                  ...contactForm,
                  name: event.target.value,
                })
              }
              value={contactForm.name}
            />
          </Field>
        </div>
        <Field label="Role">
          <select
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            onChange={(event) =>
              onChangeContactForm({
                ...contactForm,
                role: event.target.value as ContactFormState["role"],
              })
            }
            value={contactForm.role}
          >
            {[
              "pr",
              "marketing",
              "partnerships",
              "founder",
              "generic_info",
              "unknown",
            ].map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
        </Field>
        <Button className="w-fit" disabled={isSaving} type="submit">
          {isSaving ? <Loader2 className="animate-spin" /> : <Plus />}
          Add contact
        </Button>
      </form>
    </section>
  );
}

function BrandForm<T extends BrandFormState | BrandEditState>({
  form,
  onChange,
  onSubmit,
  isSaving,
  submitLabel,
  includeAliases = false,
  includeExclusion = false,
}: {
  form: T;
  onChange: (form: T) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  isSaving: boolean;
  submitLabel: string;
  includeAliases?: boolean;
  includeExclusion?: boolean;
}) {
  function patch(patchValue: Partial<T>) {
    onChange({
      ...form,
      ...patchValue,
    });
  }

  return (
    <form className="grid gap-4" onSubmit={onSubmit}>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Name">
          <Input
            onChange={(event) => patch({ name: event.target.value } as Partial<T>)}
            required
            value={form.name}
          />
        </Field>
        <Field label="Domain">
          <Input
            onChange={(event) =>
              patch({ domain: event.target.value } as Partial<T>)
            }
            placeholder="example.com or example.com/path"
            value={form.domain}
          />
        </Field>
        <Field label="Instagram">
          <Input
            onChange={(event) =>
              patch({ instagram_handle: event.target.value } as Partial<T>)
            }
            placeholder="@brand or full URL"
            value={form.instagram_handle}
          />
        </Field>
        <Field label="TikTok">
          <Input
            onChange={(event) =>
              patch({ tiktok_handle: event.target.value } as Partial<T>)
            }
            placeholder="@brand or full URL"
            value={form.tiktok_handle}
          />
        </Field>
      </div>
      {includeAliases && "aliases" in form ? (
        <Field label="Aliases">
          <ChipInput
            onChange={(value) =>
              patch({ aliases: value } as unknown as Partial<T>)
            }
            placeholder="Add alias"
            value={form.aliases}
          />
        </Field>
      ) : null}
      <Field label="Categories">
        <ChipInput
          onChange={(value) => patch({ category: value } as Partial<T>)}
          placeholder="Add category"
          value={form.category}
        />
      </Field>
      <SuggestionRow
        onPick={(category) =>
          patch({
            category: form.category.includes(category)
              ? form.category
              : [...form.category, category],
          } as Partial<T>)
        }
        values={categorySuggestions}
      />
      <Field label="Aesthetic tags">
        <ChipInput
          onChange={(value) => patch({ aesthetic_tags: value } as Partial<T>)}
          placeholder="Add tag"
          value={form.aesthetic_tags}
        />
      </Field>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Size">
          <select
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            onChange={(event) =>
              patch({ size_estimate: event.target.value as SizeInput } as Partial<T>)
            }
            value={form.size_estimate}
          >
            {sizeOptions.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Pays creators">
          <div className="flex gap-2">
            <ChoiceButton
              active={form.pays_creators === true}
              label="Yes"
              onClick={() => patch({ pays_creators: true } as Partial<T>)}
            />
            <ChoiceButton
              active={form.pays_creators === false}
              label="No"
              onClick={() => patch({ pays_creators: false } as Partial<T>)}
            />
            <ChoiceButton
              active={form.pays_creators === null}
              label="Unknown"
              onClick={() => patch({ pays_creators: null } as Partial<T>)}
            />
          </div>
        </Field>
      </div>
      <Field label="Notes">
        <Textarea
          onChange={(event) => patch({ notes: event.target.value } as Partial<T>)}
          value={form.notes}
        />
      </Field>
      {includeExclusion && "excluded" in form ? (
        <div className="grid gap-3 rounded-md border p-3">
          <Toggle
            checked={form.excluded}
            label="Excluded"
            onChange={(value) =>
              patch({ excluded: value } as unknown as Partial<T>)
            }
          />
          <Field label="Exclusion reason">
            <Input
              onChange={(event) =>
                patch({
                  exclusion_reason: event.target.value,
                } as unknown as Partial<T>)
              }
              value={form.exclusion_reason}
            />
          </Field>
        </div>
      ) : null}
      <Button className="w-fit" disabled={isSaving} type="submit">
        {isSaving ? <Loader2 className="animate-spin" /> : <Plus />}
        {submitLabel}
      </Button>
    </form>
  );
}

function Pagination({
  list,
  onPage,
}: {
  list: BrandListResult;
  onPage: (page: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
      <p>
        Page {list.page} of {list.totalPages}
      </p>
      <div className="flex gap-2">
        <Button
          disabled={list.page <= 1}
          onClick={() => onPage(list.page - 1)}
          size="sm"
          type="button"
          variant="outline"
        >
          Previous
        </Button>
        <Button
          disabled={list.page >= list.totalPages}
          onClick={() => onPage(list.page + 1)}
          size="sm"
          type="button"
          variant="outline"
        >
          Next
        </Button>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        checked={checked}
        className="size-4 accent-primary"
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
      {label}
    </label>
  );
}

function ChoiceButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      onClick={onClick}
      size="sm"
      type="button"
      variant={active ? "default" : "outline"}
    >
      {label}
    </Button>
  );
}

function SuggestionRow({
  values,
  onPick,
}: {
  values: string[];
  onPick: (value: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {values.map((value) => (
        <Button
          key={value}
          onClick={() => onPick(value)}
          size="sm"
          type="button"
          variant="outline"
        >
          {value}
        </Button>
      ))}
    </div>
  );
}

function toBrandInput(form: BrandFormState) {
  return {
    name: form.name,
    domain: form.domain,
    instagram_handle: form.instagram_handle,
    tiktok_handle: form.tiktok_handle,
    category: form.category,
    aesthetic_tags: form.aesthetic_tags,
    size_estimate:
      form.size_estimate === "unknown" ? null : form.size_estimate,
    pays_creators: form.pays_creators,
    notes: form.notes,
  };
}

function sortArrow(direction: "asc" | "desc") {
  return direction === "asc" ? "up" : "down";
}

function scoreBadgeClass(score: number) {
  if (score >= 80) {
    return "bg-emerald-600 text-white hover:bg-emerald-600";
  }

  if (score >= 60) {
    return "bg-yellow-500 text-black hover:bg-yellow-500";
  }

  if (score >= 40) {
    return "bg-amber-600 text-white hover:bg-amber-600";
  }

  return "bg-muted text-muted-foreground hover:bg-muted";
}

function contactResultLabel(result: ContactDiscoveryResult) {
  if (result.status === "success") {
    return `Found ${result.contacts_added} new and refreshed ${result.contacts_updated} contacts.`;
  }

  if (result.skipped_reason === "no_domain") {
    return "Add a domain before searching Hunter.";
  }

  if (result.skipped_reason === "no_hunter_results") {
    return "No emails found on Hunter for this domain.";
  }

  if (result.skipped_reason === "rate_limited") {
    return "Hunter rate limit reached. Try again later.";
  }

  return result.error_message ?? "Contact enrichment did not finish.";
}

function pageScrapeJobLabel(job: PageScrapeJobSummary) {
  if (job.status === "queued") {
    return "Scraping queued. Mira will check this brand's contact pages shortly.";
  }

  if (job.status === "running") {
    return "Scraping contact pages now.";
  }

  if (job.status === "succeeded") {
    const count = readContactsFound(job.result_json);

    return count === null
      ? "Scraping finished."
      : `Scraping finished. Found ${count} contact${count === 1 ? "" : "s"}.`;
  }

  if (job.status === "failed") {
    return job.error_message ?? "Scraping failed.";
  }

  return "Scraping cancelled.";
}

function instagramJobLabel(job: InstagramScrapeJobSummary) {
  if (job.status === "queued") {
    return "Instagram scrape queued.";
  }

  if (job.status === "running") {
    return "Reading recent sponsored posts now.";
  }

  if (job.status === "succeeded") {
    const created = readNumberFromJobResult(job.result_json, "brands_created");
    const merged = readNumberFromJobResult(job.result_json, "brands_merged");
    const queued = readNumberFromJobResult(
      job.result_json,
      "brands_queued_for_review",
    );

    return `Last run: ${created ?? 0} created, ${merged ?? 0} merged, ${
      queued ?? 0
    } queued.`;
  }

  if (job.status === "failed") {
    return job.error_message ?? "Instagram scrape failed.";
  }

  return "Instagram scrape cancelled.";
}

function readContactsFound(resultJson: Tables<"jobs">["result_json"]) {
  if (!resultJson || typeof resultJson !== "object" || Array.isArray(resultJson)) {
    return null;
  }

  const contacts = resultJson.contacts;

  return Array.isArray(contacts) ? contacts.length : null;
}

function readNumberFromJobResult(
  resultJson: Tables<"jobs">["result_json"],
  key: string,
) {
  if (!resultJson || typeof resultJson !== "object" || Array.isArray(resultJson)) {
    return null;
  }

  const value = resultJson[key];

  return typeof value === "number" ? value : null;
}

function confidenceLabel(confidence: number | null) {
  if (confidence === null) {
    return "manual";
  }

  if (confidence >= 80) {
    return `high ${confidence}`;
  }

  if (confidence >= 60) {
    return `medium ${confidence}`;
  }

  return `low ${confidence}`;
}

function confidenceVariant(confidence: number | null) {
  if (confidence === null) {
    return "outline" as const;
  }

  if (confidence >= 80) {
    return "default" as const;
  }

  if (confidence >= 60) {
    return "secondary" as const;
  }

  return "outline" as const;
}
