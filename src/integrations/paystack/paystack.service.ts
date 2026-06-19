import { Injectable, HttpException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface PaystackInitPayload {
  email: string;
  amount: number; // in kobo
  reference: string;
  callbackUrl?: string;
  subaccount?: string;
  split?: {
    type: 'percentage' | 'flat';
    value: number;
    bearer_type: 'subaccount' | 'account';
    subaccount: string;
  };
}

interface PaystackTransferPayload {
  source: 'balance';
  amount: number; // in kobo
  recipient: string;
  reference: string;
  reason?: string;
}

@Injectable()
export class PaystackService {
  private readonly logger = new Logger(PaystackService.name);
  private readonly baseUrl = 'https://api.paystack.co';
  private readonly secretKey: string;

  constructor(private configService: ConfigService) {
    this.secretKey = this.configService.get<string>('PAYSTACK_SECRET_KEY') || '';
  }

  private get headers() {
    return {
      Authorization: `Bearer ${this.secretKey}`,
      'Content-Type': 'application/json',
    };
  }

  async initializeTransaction(payload: PaystackInitPayload) {
    return this.post('/transaction/initialize', payload);
  }

  async verifyTransaction(reference: string) {
    return this.get(`/transaction/verify/${reference}`);
  }

  async createSubaccount(data: {
    business_name: string;
    bank_code: string;
    account_number: string;
    percentage_charge: number;
  }) {
    return this.post('/subaccount', data);
  }

  async createTransferRecipient(data: {
    type: 'nuban';
    name: string;
    account_number: string;
    bank_code: string;
    currency?: 'NGN';
  }) {
    return this.post('/transferrecipient', data);
  }

  async initiateTransfer(payload: PaystackTransferPayload) {
    return this.post('/transfer', payload);
  }

  async bulkTransfer(batch: PaystackTransferPayload[]) {
    return this.post('/transfer/bulk', { transfers: batch });
  }

  async getBankList() {
    return this.get('/bank?country=nigeria');
  }

  async resolveAccount(accountNumber: string, bankCode: string) {
    return this.get(`/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`);
  }

  private async get(path: string) {
    const url = `${this.baseUrl}${path}`;
    try {
      const res = await fetch(url, { headers: this.headers });
      const json = await res.json();
      if (!json.status) throw new HttpException(json.message || 'Paystack error', 400);
      return json;
    } catch (err: any) {
      this.logger.error(`Paystack GET ${path}: ${err.message}`);
      throw new HttpException(`Payment gateway error: ${err.message}`, 502);
    }
  }

  private async post(path: string, body: any) {
    const url = `${this.baseUrl}${path}`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!json.status) throw new HttpException(json.message || 'Paystack error', 400);
      return json;
    } catch (err: any) {
      this.logger.error(`Paystack POST ${path}: ${err.message}`);
      throw new HttpException(`Payment gateway error: ${err.message}`, 502);
    }
  }
}
