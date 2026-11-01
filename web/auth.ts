import { eq } from "drizzle-orm";
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { db, t } from "@/lib/db";

// Local dev without Google credentials skips sign-in entirely; a deployed build always requires it.
export const authDisabled = process.env.NODE_ENV !== "production" && !process.env.AUTH_GOOGLE_ID;

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
  pages: { signIn: "/login", error: "/login" },
  session: { strategy: "jwt" },
  callbacks: {
    // Only people listed in the users table (Marco, Moni) can get in.
    async signIn({ user }) {
      if (!user.email) return false;
      const [row] = await db.select({ id: t.users.id }).from(t.users).where(eq(t.users.email, user.email.toLowerCase()));
      return Boolean(row);
    },
    authorized({ auth }) {
      return authDisabled || Boolean(auth?.user);
    },
  },
});
