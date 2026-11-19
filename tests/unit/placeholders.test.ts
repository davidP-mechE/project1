import { describe, expect, it } from "vitest";
import { fillPlaceholders, firstNameOf, hasPlaceholders } from "@/lib/messaging/placeholders";

describe("message placeholders", () => {
  const v = { firstName: "Ana", className: "SAT Fall", dueDate: "Thu, Nov 20, 9:00 PM" };
  it("fills first name, class and due date, forgiving case and spaces", () => {
    expect(fillPlaceholders("Hi {first_name}, {class} work is due {due_date}.", v)).toBe("Hi Ana, SAT Fall work is due Thu, Nov 20, 9:00 PM.");
    expect(fillPlaceholders("Hi { First_Name }!", v)).toBe("Hi Ana!");
  });
  it("falls back when a value is missing, and leaves other braces alone", () => {
    expect(fillPlaceholders("Due {due_date}, {first_name}. {name} {}", { firstName: "", className: "X", dueDate: null })).toBe("Due soon, there. {name} {}");
  });
  it("finds placeholders and first names", () => {
    expect(hasPlaceholders("Hello {class}")).toBe(true);
    expect(hasPlaceholders("Hello")).toBe(false);
    expect(firstNameOf("  Ana  Diaz ")).toBe("Ana");
  });
});
