import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/misc";
import { ONLY_MESSAGE, type ProgramAccess } from "@/server/program-access";

/** Shown in place of the library, slides and Hub to accounts limited to a program (Admin → Program access). */
export function LimitedNotice({ access }: { access: ProgramAccess }) {
  return (
    <EmptyState title="Not available on your account" action={<ButtonLink href="/classes">Go to your classes</ButtonLink>}>
      {ONLY_MESSAGE(access)}
    </EmptyState>
  );
}
