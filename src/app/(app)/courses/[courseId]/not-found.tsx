import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/misc";

export default function NotFound() {
  return (
    <EmptyState title="Course not found" action={<ButtonLink href="/library">Back to library</ButtonLink>}>
      This course doesn&apos;t exist or was deleted.
    </EmptyState>
  );
}
