import { eq } from "drizzle-orm";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { db, t } from "@/lib/db";
import { verifyPassword } from "@/lib/password";

// Local dev skips sign-in unless AUTH_IN_DEV=1; a deployed build always requires it.
export const authDisabled = process.env.NODE_ENV !== "production" && process.env.AUTH_IN_DEV !== "1";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(credentials) {
        const email = String(credentials?.email ?? "").trim().toLowerCase();
        const password = String(credentials?.password ?? "");
        if (!email || !password) return null;
        const [user] = await db.select().from(t.users).where(eq(t.users.email, email));
        if (!user || !(await verifyPassword(password, user.passwordHash))) {
          // Slow down guessing.
          await new Promise((r) => setTimeout(r, 1000));
          return null;
        }
        return { id: user.id, email: user.email, name: user.name };
      },
    }),
  ],
  pages: { signIn: "/login", error: "/login" },
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 180 },
  callbacks: {
    authorized({ auth }) {
      return authDisabled || Boolean(auth?.user);
    },
  },
});
