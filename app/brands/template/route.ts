import { brandCsvTemplate } from "@/lib/brands/service";

export function GET() {
  return new Response(brandCsvTemplate, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="mira-brand-import-template.csv"',
    },
  });
}
