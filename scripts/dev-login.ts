import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const email = process.argv[2] ?? "dev@example.com";

async function main() {
  const admin = createClient(url, service);
  const { data: existing } = await admin.auth.admin.listUsers();
  if (!existing.users.some((u) => u.email === email)) {
    await admin.auth.admin.createUser({ email, email_confirm: true });
  }
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error) throw error;
  console.log(data.properties.action_link);
}

main();
