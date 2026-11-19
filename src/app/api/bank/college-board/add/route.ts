import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSession } from "@/server/session";
import { isSameOrigin, jsonError } from "@/server/http";
import { BankError } from "@/server/bank";
import { NotFoundError } from "@/server/courses";
import { importCollegeBoardRecords, MAX_CB_RECORDS, type CbRecord } from "@/server/college-board";

const body = z.object({
  records: z.array(z.record(z.string(), z.union([z.string().max(20_000), z.number(), z.record(z.string(), z.string().max(2000))]))).max(MAX_CB_RECORDS),
});

/** Add the questions the author kept to the bank, as College Board drafts. */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return jsonError("Forbidden", 403);
  const session = await getSession();
  if (!session) return jsonError("Not found", 404);
  let records: CbRecord[];
  try {
    records = body.parse(await request.json()).records;
  } catch {
    return jsonError("Invalid request.", 400);
  }
  try {
    const r = await importCollegeBoardRecords(session.user.id, records);
    revalidatePath("/bank");
    return NextResponse.json({ imported: r.imported, skipped: r.skipped.length, failed: r.failed, questionIds: r.questionIds });
  } catch (err) {
    if (err instanceof NotFoundError) return jsonError("Not found", 404);
    if (err instanceof BankError) return jsonError(err.message, err.status);
    console.error("[college-board] add failed:", err);
    return jsonError("Something went wrong. Please try again.", 500);
  }
}
