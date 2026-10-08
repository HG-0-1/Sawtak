import type { Config } from './config.js';

export type SmsReceipt = { provider: 'mock' | 'http'; messageId?: string };

export class SmsDeliveryError extends Error {}

export interface SmsProvider {
  sendOtp(phoneE164: string, code: string): Promise<SmsReceipt>;
}

class MockSmsProvider implements SmsProvider {
  async sendOtp(_phoneE164: string, _code: string): Promise<SmsReceipt> {
    // Intentionally neither logs nor returns the code. Development uses DEMO_OTP_CODE from server config.
    return { provider: 'mock' };
  }
}

class HttpSmsProvider implements SmsProvider {
  constructor(private readonly config: Config) {}
  async sendOtp(phoneE164: string, code: string): Promise<SmsReceipt> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.config.SMS_HTTP_AUTH_HEADER) {
      const separator = this.config.SMS_HTTP_AUTH_HEADER.indexOf(':');
      if (separator < 1) throw new SmsDeliveryError('SMS_HTTP_AUTH_HEADER must be Header-Name: value');
      headers[this.config.SMS_HTTP_AUTH_HEADER.slice(0, separator).trim()] = this.config.SMS_HTTP_AUTH_HEADER.slice(separator + 1).trim();
    }
    const response = await fetch(this.config.SMS_HTTP_URL!, {
      method: 'POST', headers,
      body: JSON.stringify({ to: phoneE164, senderId: this.config.SMS_SENDER_ID, body: `Your Maker Collective code is ${code}. It expires in 5 minutes.` }),
      signal: AbortSignal.timeout(8_000)
    }).catch(() => { throw new SmsDeliveryError('SMS request failed'); });
    if (!response.ok) throw new SmsDeliveryError(`SMS provider returned ${response.status}`);
    const payload = await response.json().catch(() => ({})) as { id?: string; messageId?: string };
    return { provider: 'http', messageId: payload.messageId ?? payload.id };
  }
}

export function createSmsProvider(config: Config): SmsProvider {
  return config.SMS_PROVIDER === 'http' ? new HttpSmsProvider(config) : new MockSmsProvider();
}
