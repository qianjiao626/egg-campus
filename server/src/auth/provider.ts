import crypto from 'node:crypto';
import type { VerificationChannel, VerificationPurpose } from './verification.js';

export interface VerificationMessage {
  channel: VerificationChannel;
  target: string;
  code: string;
  purpose: VerificationPurpose;
}

export interface VerificationProvider {
  send(message: VerificationMessage): Promise<void>;
}

export class MockVerificationProvider implements VerificationProvider {
  private messages: VerificationMessage[] = [];

  async send(message: VerificationMessage) {
    this.messages.push({ ...message });
  }

  lastMessage() {
    const message = this.messages.at(-1);
    return message ? { ...message } : undefined;
  }
}

export class UnconfiguredVerificationProvider implements VerificationProvider {
  async send() {
    throw new Error('VERIFICATION_PROVIDER_NOT_CONFIGURED');
  }
}

type TencentSmsConfig = {
  secretId?: string;
  secretKey?: string;
  sdkAppId?: string;
  signName?: string;
  templateId?: string;
  region?: string;
};

function hmac(key: crypto.BinaryLike, value: string) {
  return crypto.createHmac('sha256', key).update(value).digest();
}

function sha256(value: string) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export class TencentSmsVerificationProvider implements VerificationProvider {
  constructor(private readonly config: TencentSmsConfig) {}

  async send(message: VerificationMessage) {
    if (message.channel !== 'sms' || !this.config.secretId || !this.config.secretKey || !this.config.sdkAppId || !this.config.signName || !this.config.templateId) {
      throw new Error('VERIFICATION_PROVIDER_NOT_CONFIGURED');
    }
    const host = 'sms.tencentcloudapi.com';
    const service = 'sms';
    const timestamp = Math.floor(Date.now() / 1000);
    const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
    const payload = JSON.stringify({
      SmsSdkAppId: this.config.sdkAppId,
      SignName: this.config.signName,
      TemplateId: this.config.templateId,
      TemplateParamSet: [message.code, '5'],
      PhoneNumberSet: [`+86${message.target}`],
    });
    const contentType = 'application/json; charset=utf-8';
    const signedHeaders = 'content-type;host';
    const canonicalHeaders = `content-type:${contentType}\nhost:${host}\n`;
    const canonicalRequest = `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${sha256(payload)}`;
    const credentialScope = `${date}/${service}/tc3_request`;
    const stringToSign = `TC3-HMAC-SHA256\n${timestamp}\n${credentialScope}\n${sha256(canonicalRequest)}`;
    const secretDate = hmac(`TC3${this.config.secretKey}`, date);
    const secretService = hmac(secretDate, service);
    const secretSigning = hmac(secretService, 'tc3_request');
    const signature = crypto.createHmac('sha256', secretSigning).update(stringToSign).digest('hex');
    const authorization = `TC3-HMAC-SHA256 Credential=${this.config.secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    const response = await fetch(`https://${host}`, {
      method: 'POST',
      headers: {
        'Content-Type': contentType,
        Host: host,
        'X-TC-Action': 'SendSms',
        'X-TC-Version': '2021-01-11',
        'X-TC-Region': this.config.region || 'ap-nanjing',
        'X-TC-Timestamp': String(timestamp),
        'X-TC-Language': 'zh-CN',
        Authorization: authorization,
      },
      body: payload,
    });
    const result = await response.json().catch(() => ({})) as { Response?: { Error?: { Code?: string; Message?: string } } };
    if (!response.ok || result.Response?.Error) {
      throw new Error(`TENCENT_SMS_FAILED:${result.Response?.Error?.Code || response.status}`);
    }
  }
}

export function createVerificationProvider(kind: 'mock' | 'tencent_sms' | 'smtp', config: TencentSmsConfig = {}): VerificationProvider {
  if (kind === 'mock') return new MockVerificationProvider();
  if (kind === 'tencent_sms') return new TencentSmsVerificationProvider(config);
  return new UnconfiguredVerificationProvider();
}
