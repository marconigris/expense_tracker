import { eq } from "drizzle-orm";
import { auth, authDisabled } from "@/auth";
import { db, t } from "./db";

/** The signed-in user's row, or an error. Every server action and data read goes through here. */
export async function requireUser() {
  if (authDisabled) {
    const [owner] = await db.select().from(t.users).where(eq(t.users.role, "owner"));
    if (!owner) throw new Error("No owner user; run npm run db:seed");
    return owner;
  }
  const email = (await auth())?.user?.email?.toLowerCase();
  if (!email) throw new Error("No autenticado");
  const [user] = await db.select().from(t.users).where(eq(t.users.email, email));
  if (!user) throw new Error("Sin acceso");
  return user;
}

/** Marco only. Moni's shared-space views will use requireUser and filter by entity. */
export async function requireOwner() {
  const user = await requireUser();
  if (user.role !== "owner") throw new Error("Solo Marco puede ver esto por ahora");
  return user;
}
