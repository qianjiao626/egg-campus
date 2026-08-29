import { z } from 'zod';

const booleanEnv = (defaultValue: boolean) => z.preprocess(
  (value) => value === undefined ? defaultValue : value === true || value === 'true',
  z.boolean(),
);

const configSchema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default('0.0.0.0'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  VERIFICATION_PROVIDER: z.enum(['disabled', 'mock', 'smtp']).default('disabled'),
  VERIFICATION_CODE_TTL_SECONDS: z.coerce.number().int().min(60).max(900).default(300),
  VERIFICATION_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().min(10).max(300).default(60),
  VERIFICATION_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(5),
  REFRESH_COOKIE_ENABLED: booleanEnv(false),
  COOKIE_SECURE: booleanEnv(true),
  COOKIE_DOMAIN: z.string().optional(),
  // Keep the refresh cookie available to both auth and buddy-box API routes.
  COOKIE_PATH: z.string().default('/api'),
  FEEDBACK_ATTACHMENT_ROOT: z.string().min(1).default('./var/private/feedback'),
  SHOP_ENABLED: booleanEnv(false),
  SHOP_IMAGE_ROOT: z.string().min(1).default('./var/public/shop-images'),
  SHOP_REDEEM_CODE_SECRET: z.string().min(32).optional(),
});

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  return configSchema.parse(env);
}
