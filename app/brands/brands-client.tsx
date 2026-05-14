"use client";

import { Loader2, Pencil, Plus, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import type React from "react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  addBrandManual,
  addBrandsFromCsv,
  toggleBrandExcluded,
  updateBrand,
} from "@/app/actions/brands";
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

export function BrandsClient({ initialList }: { initialList: BrandListResult }) {
  const router = useRouter();
  const [manualForm, setManualForm] = useState<BrandFormState>(emptyBrandForm);
  const [csvResult, setCsvResult] = useState<CsvImportResult | null>(null);
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

      toast.success(result.data.created ? "Brand created." : "Brand merged.");
      setManualForm(emptyBrandForm);
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

  function openEdit(brand: Tables<"brands">) {
    setEditingBrand(brand);
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
    router.push(`/brands?${params.toString()}`);
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
        </div>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
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

        <Card>
          <CardHeader>
            <CardTitle>Brands</CardTitle>
            <CardDescription>
              {initialList.total} matching brand
              {initialList.total === 1 ? "" : "s"}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5">
            <FiltersBar
              categoryOptions={initialList.categoryOptions}
              filters={filters}
              onApply={(nextFilters) => applyFilters(nextFilters)}
              onChange={setFilters}
            />
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
          ) : null}
        </DialogContent>
      </Dialog>
    </main>
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
  onEdit: (brand: Tables<"brands">) => void;
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
            <TableCell className="py-10 text-center text-muted-foreground" colSpan={9}>
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
