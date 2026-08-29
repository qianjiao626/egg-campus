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

export function createVerificationProvider(kind: 'disabled' | 'mock' | 'smtp'): VerificationProvider {
  if (kind === 'mock') return new MockVerificationProvider();
  return new UnconfiguredVerificationProvider();
}
