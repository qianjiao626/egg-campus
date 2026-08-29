import { buildApp, refundExpiredInquiries, refundExpiredTasks } from './app.js';
import { loadConfig } from './config.js';
import { prisma } from './prisma.js';
import { seedAuthorizationCatalog } from './rbac-seed.js';
import { runShopMaintenance, type ShopMaintenanceClient } from './shop-maintenance.js';

function nonOverlappingSweep(task: () => Promise<void>, onError: (error: unknown) => void) {
  let running = false;
  return async () => {
    if (running) return;
    running = true;
    try {
      await task();
    } catch (error) {
      onError(error);
    } finally {
      running = false;
    }
  };
}

const config = loadConfig();
await seedAuthorizationCatalog(prisma);
const app = buildApp();
const verificationCleanup = setInterval(nonOverlappingSweep(
  async () => { await prisma.verificationCode.deleteMany({ where: { expiresAt: { lt: new Date() } } }); },
  (error) => app.log.error({ err: error }, 'verification cleanup failed'),
), 15 * 60 * 1000);
verificationCleanup.unref();
const inquiryRefundSweep = setInterval(nonOverlappingSweep(
  async () => { await refundExpiredInquiries(); await refundExpiredTasks(); },
  (error) => app.log.error({ err: error }, 'inquiry refund sweep failed'),
), 5 * 60 * 1000);
inquiryRefundSweep.unref();
let shopMaintenanceSweep: NodeJS.Timeout | undefined;
if (config.SHOP_ENABLED) {
  shopMaintenanceSweep = setInterval(nonOverlappingSweep(
    async () => { await runShopMaintenance(prisma as unknown as ShopMaintenanceClient); },
    (error) => app.log.error({ err: error }, 'shop maintenance sweep failed'),
  ), 15 * 60 * 1000);
  shopMaintenanceSweep.unref();
}

try {
  await app.listen({ host: config.HOST, port: config.PORT });
} catch (error) {
  app.log.error(error);
  await prisma.$disconnect();
  process.exit(1);
}

const shutdown = async () => {
  clearInterval(verificationCleanup);
  clearInterval(inquiryRefundSweep);
  if (shopMaintenanceSweep) clearInterval(shopMaintenanceSweep);
  await app.close();
  await prisma.$disconnect();
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
