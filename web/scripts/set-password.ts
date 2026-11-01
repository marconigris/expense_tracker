// npm run set-password -- <email>   (uses .env, or .env.prod when present → production)
import { eq } from "drizzle-orm";
import { db, t } from "../lib/db";
import { hashPassword } from "../lib/password";

/** Reads a line from the terminal without echoing it. */
function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let value = "";
    const onData = (ch: string) => {
      if (ch === "\r" || ch === "\n") {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.off("data", onData);
        process.stdout.write("\n");
        resolve(value);
      } else if (ch === "\u0003") {
        process.exit(1);
      } else if (ch === "\u007f") {
        value = value.slice(0, -1);
      } else {
        value += ch;
      }
    };
    stdin.on("data", onData);
  });
}

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) throw new Error("Uso: npm run set-password -- <email>");
  const [user] = await db.select().from(t.users).where(eq(t.users.email, email));
  if (!user) throw new Error(`No existe el usuario ${email}`);

  const host = new URL(process.env.DATABASE_URL!).host;
  console.log(`Base: ${host}`);
  const password = await promptHidden(`Nueva contraseña para ${user.name}: `);
  if (password.length < 10) throw new Error("Usá al menos 10 caracteres");
  if ((await promptHidden("Repetila: ")) !== password) throw new Error("No coinciden");

  await db.update(t.users).set({ passwordHash: await hashPassword(password) }).where(eq(t.users.id, user.id));
  console.log("Contraseña guardada.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
