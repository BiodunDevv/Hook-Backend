import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class GoogleMapsService {
  private readonly logger = new Logger(GoogleMapsService.name);
  private readonly apiKey: string;

  constructor(private configService: ConfigService) {
    this.apiKey = configService.get<string>('GOOGLE_MAPS_API_KEY') || '';
  }

  async geocode(address: string) {
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${this.apiKey}`,
    );
    return res.json();
  }

  async reverseGeocode(lat: number, lng: number) {
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${this.apiKey}`,
    );
    return res.json();
  }

  async calculateDistance(origin: string, dest: string) {
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/distancematrix/json?units=metric&origins=${encodeURIComponent(origin)}&destinations=${encodeURIComponent(dest)}&key=${this.apiKey}`,
    );
    return res.json();
  }

  async validateAddress(address: string): Promise<boolean> {
    const result = await this.geocode(address);
    return result.status === 'OK' && result.results?.length > 0;
  }
}
