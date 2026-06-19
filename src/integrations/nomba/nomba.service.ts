import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class NombaService {
  private readonly logger = new Logger(NombaService.name);
  private readonly baseUrl = 'https://api.nomba.com/v1';
  private readonly secretKey: string;

  constructor(private configService: ConfigService) {
    this.secretKey = configService.get<string>('NOMBA_SECRET_KEY') || '';
  }

  private get headers() {
    return { Authorization: `Bearer ${this.secretKey}`, 'Content-Type': 'application/json' };
  }

  async initializeTransaction(data: { email: string; amount: number; reference: string; callbackUrl?: string }) {
    return this.post('/payments/initialize', data);
  }

  async verifyTransaction(reference: string) {
    return this.get(`/payments/verify/${reference}`);
  }

  async createVirtualAccount(data: { customer: string; customerEmail: string; phone?: string }) {
    return this.post('/virtual-accounts', data);
  }

  private async get(path: string) {
    try {
      const res = await fetch(`${this.baseUrl}${path}`, { headers: this.headers });
      return res.json();
    } catch (err: any) {
      this.logger.error(`Nomba GET ${path}: ${err.message}`);
      throw err;
    }
  }

  private async post(path: string, body: any) {
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST', headers: this.headers, body: JSON.stringify(body),
      });
      return res.json();
    } catch (err: any) {
      this.logger.error(`Nomba POST ${path}: ${err.message}`);
      throw err;
    }
  }
}
