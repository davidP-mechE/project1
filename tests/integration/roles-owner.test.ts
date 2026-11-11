import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { isOwner, setSiteRole, syncOwnerRole } from "@/server/roles";
import { createUser, resetDb } from "../helpers/db";

describe("OWNER_EMAIL and site roles", () => {
  const saved = process.env.OWNER_EMAIL;
  beforeEach(resetDb);
  afterEach(() => {
    process.env.OWNER_EMAIL = saved;
  });

  it("gives the owner role to the verified OWNER_EMAIL account only, and takes it from anyone else", async () => {
    const me = await createUser("Owner");
    const other = await createUser("Other");
    await db.user.update({ where: { id: other.id }, data: { role: "OWNER" } }); // e.g. a previous owner
    process.env.OWNER_EMAIL = me.email.toUpperCase();
    await syncOwnerRole();
    expect((await db.user.findUniqueOrThrow({ where: { id: me.id } })).role).toBe("OWNER");
    expect((await db.user.findUniqueOrThrow({ where: { id: other.id } })).role).toBe("USER");
    expect(await isOwner(me.id)).toBe(true);
    expect(await isOwner(other.id)).toBe(false);
  });

  it("an unverified account with the owner's email is not the owner", async () => {
    const u = await createUser("Unverified");
    await db.user.update({ where: { id: u.id }, data: { emailVerified: false } });
    process.env.OWNER_EMAIL = u.email;
    await syncOwnerRole();
    expect((await db.user.findUniqueOrThrow({ where: { id: u.id } })).role).toBe("USER");
  });

  it("the OWNER role alone isn't enough: the email must still match OWNER_EMAIL", async () => {
    const u = await createUser("Stale");
    await db.user.update({ where: { id: u.id }, data: { role: "OWNER" } });
    process.env.OWNER_EMAIL = "someone-else@example.com";
    expect(await isOwner(u.id)).toBe(false);
    delete process.env.OWNER_EMAIL;
    expect(await isOwner(u.id)).toBe(false);
  });

  it("only the owner can approve tutors", async () => {
    const owner = await createUser("Owner");
    const tutor = await createUser("Tutor");
    const student = await createUser("Student");
    process.env.OWNER_EMAIL = owner.email;
    await syncOwnerRole();
    await expect(setSiteRole(student.id, tutor.id, "TUTOR")).rejects.toThrow(/Only the owner/);
    await setSiteRole(owner.id, tutor.id, "TUTOR");
    expect((await db.user.findUniqueOrThrow({ where: { id: tutor.id } })).role).toBe("TUTOR");
  });
});
