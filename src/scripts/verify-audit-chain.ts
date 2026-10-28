import { verifyAuditChain } from '../modules/audit/audit.service.js';
import { prisma } from '@infrastructure/database/index.js';
import { logger } from '@core/logger/index.js';

async function main(): Promise<void> {
  logger.info('Starting audit log cryptographic chain verification...');
  try {
    const result = await verifyAuditChain();
    if (result.isValid) {
      logger.info('✅ Audit log database chain verification SUCCESS. The ledger is intact.');
      process.exit(0);
    } else {
      logger.error(
        `❌ CRITICAL: Audit log chain validation FAILED! Broken at record ID: ${result.brokenAt}`
      );
      process.exit(1);
    }
  } catch (err) {
    logger.error(err, 'Failed to run audit chain verification');
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
