/**
 * Placeholders in saved replies and messages from staff, filled in for each
 * student when the message is sent:
 *   {first_name}  the student's first name
 *   {class}       the class's name
 *   {due_date}    when the student's next assignment in that class is due,
 *                 in the student's time zone (or "soon" if nothing is due)
 * Spelling is forgiving ({First_Name}, { class }); anything else in braces is left as typed.
 */

export const PLACEHOLDERS = [
  { token: "{first_name}", help: "the student's first name" },
  { token: "{class}", help: "the class's name" },
  { token: "{due_date}", help: "when their next assignment in the class is due" },
] as const;

export type PlaceholderValues = { firstName: string; className: string; dueDate: string | null };

const PATTERN = /\{\s*(first_name|class|due_date)\s*\}/gi;

export function fillPlaceholders(text: string, v: PlaceholderValues) {
  return text.replace(PATTERN, (_m, key: string) => {
    switch (key.toLowerCase()) {
      case "first_name":
        return v.firstName || "there";
      case "class":
        return v.className;
      default:
        return v.dueDate ?? "soon";
    }
  });
}

/** Does the text use any placeholder? (Announcements fill only {class}; the rest read as "everyone"/"soon".) */
export const hasPlaceholders = (text: string) => new RegExp(PATTERN.source, "i").test(text);

/** The first word of a name, for {first_name}. */
export const firstNameOf = (name: string) => name.trim().split(/\s+/)[0] ?? "";
