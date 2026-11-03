import path from 'node:path';
import { prisma } from '../src/infrastructure/database/connection.js';
import {
  loadPlaceholderPolicies,
  loadPolicyFolder,
} from '../src/modules/policies/policy-loader.js';

/**
 * Loads policy documents without the admin screen, for the first setup.
 *
 *   npm run policies:load -- --dir ./policies          reads ./policies/manifest.json
 *   npm run policies:load -- --placeholders            development only: marked stand-ins for any country
 *                                                      and policy type that has no current version
 *
 * See src/modules/policies/policy-loader.ts for the manifest format. A version that already exists is skipped.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dirIndex = args.indexOf('--dir');
  let report;
  if (args.includes('--placeholders')) report = await loadPlaceholderPolicies();
  else if (dirIndex >= 0 && args[dirIndex + 1])
    report = await loadPolicyFolder(path.resolve(args[dirIndex + 1]!));
  else
    throw new Error('Use --dir <folder with manifest.json> or --placeholders (development only).');
  for (const label of report.loaded) console.log(`loaded  ${label}`);
  for (const label of report.skipped) console.log(`skipped ${label}`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
