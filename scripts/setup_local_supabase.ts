import { $ } from 'bun';
import { existsSync } from 'fs';
const home = Bun.env.HOME || Bun.env.USERPROFILE;
const supabaseAuthPath = `${home}/.supabase/config.toml`;

await $`echo Logging into Supabase CLI if needed...`;

if (!existsSync(supabaseAuthPath)) {
    await $`supabase login`;
}

const configFile = Bun.file('supabase/config.toml');
if (!(await configFile.exists())) {
    await $`echo Initializing Supabase project...`;
    await $`supabase init`;
}

await $`echo Stopping any existing Supabase dev environment...`;
try {
    await $`supabase stop`;
} catch {
    await $`echo "No containers to stop — continuing."`;
}

await $`echo Ensuring email auth is enabled...`;
await $`supabase auth enable email`;

await $`echo Generating migration from schema...`;
await $`supabase db diff -f create_workspaces`;

await $`echo Starting Supabase dev environment...`;
await $`supabase start`;

await $`echo ✅ Supabase local setup complete."`;
