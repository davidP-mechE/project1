"use client";

import Link from "next/link";

/** Back and Print, hidden on paper. "Save as PDF" is in the browser's print dialog. */
export function PrintBar({ back, label }: { back: string; label: string }) {
  return (
    <div className="no-print sticky top-0 z-10 mb-8 flex items-center gap-3 border-b border-neutral-200 bg-white/95 px-4 py-3 text-sm backdrop-blur">
      <Link href={back as never} className="text-neutral-600 hover:underline">
        ← Back
      </Link>
      <span className="text-neutral-500">{label}</span>
      <button type="button" onClick={() => window.print()} className="ml-auto rounded-lg bg-[#14213d] px-4 py-2 font-medium text-[#fbf5e6] hover:bg-[#0c1529]">
        Print or save as PDF
      </button>
    </div>
  );
}
