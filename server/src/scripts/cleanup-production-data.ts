import { prisma } from '../prisma.js';
import {
  assertCleanupConfirmation,
  cleanupProductionData,
  PRODUCTION_ALLOWLIST,
  type CleanupClient,
} from '../production-cleanup.js';

async function main() {
  assertCleanupConfirmation(process.argv.slice(2));
  const result = await cleanupProductionData(prisma as unknown as CleanupClient, PRODUCTION_ALLOWLIST);
  process.stdout.write(`生产数据清理完成：保留 ${result.retainedUsers} 个账号，删除 ${result.deletedUsers} 个账号，重建前删除 ${result.deletedPointTransactions} 条蛋蛋币流水。\n`);
}

main()
  .catch((error) => {
    const code = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
    process.stderr.write(`生产数据清理失败：${code}\n`);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
