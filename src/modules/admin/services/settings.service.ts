import { Injectable, Logger } from '@nestjs/common';

interface PlatformSettings {
  defaultCommissionPercentage: number;
  deliveryFeePerKm: number;
  baseDeliveryFee: number;
  maintenanceMode: boolean;
  maintenanceMessage: string;
  updatedAt: string;
}

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  private settings: PlatformSettings = {
    defaultCommissionPercentage: 15,
    deliveryFeePerKm: 200,
    baseDeliveryFee: 500,
    maintenanceMode: false,
    maintenanceMessage: '',
    updatedAt: new Date().toISOString(),
  };

  async getSettings(): Promise<PlatformSettings> {
    return { ...this.settings };
  }

  async updateSettings(dto: Partial<PlatformSettings>): Promise<PlatformSettings> {
    Object.assign(this.settings, dto, { updatedAt: new Date().toISOString() });
    this.logger.log('Platform settings updated');
    return { ...this.settings };
  }
}
