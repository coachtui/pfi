import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";

const STATE_PATH = path.resolve(__dirname, ".state.json");

/** Deletes the throwaway user (FK cascades remove all of its rows). */
export default async function globalTeardown(): Promise<void> {
  if (!fs.existsSync(STATE_PATH)) return;
  const { userId } = JSON.parse(fs.readFileSync(STATE_PATH, "utf8")) as { userId: string };
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && service && userId) {
    const admin = createClient(url, service);
    await admin.auth.admin.deleteUser(userId);
  }
  fs.unlinkSync(STATE_PATH);
}
