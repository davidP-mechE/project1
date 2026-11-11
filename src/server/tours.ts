import "server-only";
import { db } from "./db";

/** Which first-login walkthroughs to show: the student one to class members, the staff one to program staff, once each. */
export async function toursToShow(userId: string) {
  const [u, member, staff] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: { toursSeen: true } }),
    db.classMember.count({ where: { userId } }),
    db.class.count({ where: { OR: [{ program: { adminId: userId } }, { staff: { some: { userId } } }] } }),
  ]);
  const seen = new Set(u?.toursSeen ?? []);
  return { student: member > 0 && !seen.has("student"), staff: staff > 0 && !seen.has("staff") };
}
