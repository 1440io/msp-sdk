/**
 * Sweep records left behind by a crashed integration run.
 *
 * Everything the suite creates is named with the `msp-it-` prefix, so this can
 * find and remove orphans without touching anything real. Dry-run by default;
 * pass `--apply` to actually delete.
 */
import { isMspApiError, MspClient } from '@1440io/msp-api';
import { env, hasCredentials, RESOURCE_PREFIX } from '../env.ts';

if (!hasCredentials) {
  console.error('✗ MSP_API_KEY is not set.');
  process.exit(1);
}

const apply = process.argv.includes('--apply');
const client = new MspClient({ apiKey: env.apiKey!, baseUrl: env.baseUrl });

console.log(`\nSweeping "${RESOURCE_PREFIX}*" on ${env.baseUrl}${apply ? '' : ' (dry run)'}\n`);

let found = 0;
let removed = 0;

async function remove(kind: string, id: string, name: string, fn: () => Promise<unknown>) {
  found += 1;
  if (!apply) {
    console.log(`  would delete ${kind} ${name} (${id})`);
    return;
  }
  try {
    await fn();
    removed += 1;
    console.log(`  deleted ${kind} ${name} (${id})`);
  } catch (error) {
    const detail = isMspApiError(error) ? `${error.status} ${error.message}` : String(error);
    console.warn(`  could not delete ${kind} ${name} (${id}): ${detail}`);
  }
}

// Only never-published drafts can be deleted; published templates can be
// archived, and an archived one has nowhere further to go.
for (const status of ['draft', 'published', 'archived'] as const) {
  const templates = await client.admin.templates
    .list({ status, count: 100 })
    .toArray(500)
    .catch(() => []);

  for (const template of templates) {
    if (!template.name.startsWith(RESOURCE_PREFIX)) continue;

    if (status === 'draft') {
      await remove('draft template', template.id, template.name, () =>
        client.admin.templates.delete(template.id),
      );
    } else if (status === 'published') {
      await remove('published template (archiving)', template.id, template.name, () =>
        client.admin.templates.archive(template.id),
      );
    } else {
      found += 1;
      console.log(`  archived template ${template.name} (${template.id}) — nothing further to do`);
    }
  }
}

const assets = await client.admin.templates.listAssets({ count: 100 }).toArray(500).catch(() => []);
for (const asset of assets) {
  if (!asset.displayName.startsWith(RESOURCE_PREFIX)) continue;
  await remove('asset', asset.id, asset.displayName, () =>
    client.admin.templates.deleteAsset(asset.id),
  );
}

console.log(
  `\n${found} orphan(s) found${apply ? `, ${removed} deleted` : ' — re-run with --apply to delete'}.\n`,
);
