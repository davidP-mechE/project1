import { getSession } from "@/server/session";
import { jsonError } from "@/server/http";
import { canAuthor } from "@/server/bank";
import { TEMPLATE_EXAMPLES, TEMPLATE_FIELDS, templateJson } from "@/lib/bank/import";
import { toCsv } from "@/lib/csv";

/** The import template (CSV or JSON), for the owner and tutors. */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session || !(await canAuthor(session.user.id))) return jsonError("Not found", 404);
  const format = new URL(request.url).searchParams.get("format") === "json" ? "json" : "csv";
  if (format === "json") {
    return new Response(templateJson(), { headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": 'attachment; filename="question-template.json"' } });
  }
  const rows = [
    [...TEMPLATE_FIELDS],
    ...TEMPLATE_EXAMPLES.map((ex) => TEMPLATE_FIELDS.map((f) => {
      const v = (ex as Record<string, unknown>)[f];
      return typeof v === "object" ? JSON.stringify(v) : (v as string | number);
    })),
  ];
  return new Response(toCsv(rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="question-template.csv"' } });
}
