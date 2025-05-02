import { $ } from 'bun';
import { existsSync, readFileSync } from 'node:fs';

const configPath = 'supabase/config.toml';

// Check if supabase/config.toml exists
if (!existsSync(configPath)) {
    console.error(
        '❌ Supabase project not initialized. Run setup_local_supabase.ts first.'
    );
    process.exit(1);
}

// Check if project is linked (has project_id)
const configText = readFileSync(configPath, 'utf8');
if (!configText.includes('project_id')) {
    console.log('🌐 Supabase project not linked. Linking now...');
    await $`supabase link`;
}

await $`echo 📄 Generating migration from current schema...`;
await $`supabase db diff -f remote_sync`;

await $`echo 🚀 Pushing local migrations to remote Supabase...`;
await $`supabase db push`;

await $`echo ✅ Remote deployment complete.`;
