import { buildApp, refundExpiredInquiries } from './app.js';
import { loadConfig } from './config.js';
import { prisma } from './prisma.js';

const config = loadConfig();
const app = buildApp();
const verificationCleanup = setInterval(async () => {
  await prisma.verificationCode.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  }).catch((error) => app.log.error({ err: error }, 'verification cleanup failed'));
}, 15 * 60 * 1000);
verificationCleanup.unref();
const inquiryRefundSweep = setInterval(async () => {
  await refundExpiredInquiries().catch((error) => app.log.error({ err: error }, 'inquiry refund sweep failed'));
}, 5 * 60 * 1000);
inquiryRefundSweep.unref();

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
  await app.close();
  await prisma.$disconnect();
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
