import { z } from "zod";

export const brandSizeEstimateSchema = z.enum([
  "pre-launch",
  "indie-small",
  "indie-medium",
  "established-dtc",
  "legacy-large",
]);

export const brandSizeEstimateInputSchema = z
  .union([brandSizeEstimateSchema, z.literal("unknown"), z.literal(""), z.null()])
  .transform((value) =>
    value === "unknown" || value === "" ? null : value,
  );

const textArraySchema = z
  .array(z.string().trim().min(1))
  .transform((items) => [...new Set(items.map((item) => item.trim()))]);

const nullableTrimmedTextSchema = z
  .string()
  .trim()
  .transform((value) => (value.length > 0 ? value : null))
  .nullable()
  .optional();

export const brandFormSchema = z.object({
  name: z.string().trim().min(1, "Add a brand name."),
  domain: nullableTrimmedTextSchema,
  instagram_handle: nullableTrimmedTextSchema,
  tiktok_handle: nullableTrimmedTextSchema,
  category: textArraySchema.default([]),
  aesthetic_tags: textArraySchema.default([]),
  size_estimate: brandSizeEstimateInputSchema.default(null),
  pays_creators: z.boolean().nullable().default(null),
  notes: z.string().trim().optional().default(""),
});

export const brandUpdateSchema = brandFormSchema.extend({
  aliases: textArraySchema.default([]),
  excluded: z.boolean().default(false),
  exclusion_reason: z.string().trim().nullable().optional(),
});

export const brandFiltersSchema = z.object({
  query: z.string().trim().optional().default(""),
  categories: z.array(z.string().trim().min(1)).default([]),
  size_estimate: brandSizeEstimateInputSchema.default(null),
  has_contacts: z.boolean().default(false),
  excluded: z.boolean().default(false),
  page: z.number().int().positive().default(1),
  sort: z.enum(["created_at", "name"]).default("created_at"),
  direction: z.enum(["asc", "desc"]).default("desc"),
});

export const csvBrandRowSchema = z.object({
  name: z.string().trim().min(1, "name is required"),
  domain: z.string().trim().optional().default(""),
  instagram_handle: z.string().trim().optional().default(""),
  tiktok_handle: z.string().trim().optional().default(""),
  category: z.string().trim().optional().default(""),
  aesthetic_tags: z.string().trim().optional().default(""),
  size_estimate: z.string().trim().optional().default(""),
  pays_creators: z.string().trim().optional().default(""),
  notes: z.string().trim().optional().default(""),
});

export const brandCsvHeaders = [
  "name",
  "domain",
  "instagram_handle",
  "tiktok_handle",
  "category",
  "aesthetic_tags",
  "size_estimate",
  "pays_creators",
  "notes",
] as const;

export type BrandFormInput = z.input<typeof brandFormSchema>;
export type BrandFormValues = z.infer<typeof brandFormSchema>;
export type BrandUpdateInput = z.input<typeof brandUpdateSchema>;
export type BrandUpdateValues = z.infer<typeof brandUpdateSchema>;
export type BrandFilters = z.infer<typeof brandFiltersSchema>;
export type CsvBrandRow = z.infer<typeof csvBrandRowSchema>;
