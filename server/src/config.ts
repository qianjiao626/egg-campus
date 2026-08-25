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
  VERIFICATION_PROVIDER: z.enum(['mock', 'tencent_sms', 'smtp']).default('mock'),
  VERIFICATION_CODE_TTL_SECONDS: z.coerce.number().int().min(60).max(900).default(300),
  VERIFICATION_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().min(10).max(300).default(60),
  VERIFICATION_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(5),
  REFRESH_COOKIE_ENABLED: booleanEnv(false),
  COOKIE_SECURE: booleanEnv(true),
  COOKIE_DOMAIN: z.string().optional(),
  // Keep the refresh cookie available to both auth and buddy-box API routes.
  COOKIE_PATH: z.string().default('/api'),
  TENCENTCLOUD_SECRET_ID: z.string().optional(),
  TENCENTCLOUD_SECRET_KEY: z.string().optional(),
  TENCENT_SMS_SDK_APP_ID: z.string().optional(),
  TENCENT_SMS_SIGN_NAME: z.string().optional(),
  TENCENT_SMS_TEMPLATE_ID: z.string().optional(),
  TENCENT_SMS_REGION: z.string().default('ap-nanjing'),
}).superRefine((value, ctx) => {
  if (value.VERIFICATION_PROVIDER === 'tencent_sms') {
    const required: Array<[keyof typeof value, string]> = [
      ['TENCENTCLOUD_SECRET_ID', 'TENCENTCLOUD_SECRET_ID'],
      ['TENCENTCLOUD_SECRET_KEY', 'TENCENTCLOUD_SECRET_KEY'],
      ['TENCENT_SMS_SDK_APP_ID', 'TENCENT_SMS_SDK_APP_ID'],
      ['TENCENT_SMS_SIGN_NAME', 'TENCENT_SMS_SIGN_NAME'],
      ['TENCENT_SMS_TEMPLATE_ID', 'TENCENT_SMS_TEMPLATE_ID'],
    ];
    for (const [key, name] of required) {
      if (!value[key]) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: `${name} is required when Tencent SMS is enabled` });
    }
  }
});

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  return configSchema.parse(env);
}
