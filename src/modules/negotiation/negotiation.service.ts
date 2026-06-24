import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Negotiation } from './entities/negotiation.entity';
import { Product } from '@modules/products/entities/product.entity';
import { NegotiationStatus } from '@common/constants';

@Injectable()
export class NegotiationService {
  private readonly logger = new Logger(NegotiationService.name);

  constructor(
    @InjectRepository(Negotiation) private negRepo: Repository<Negotiation>,
    @InjectRepository(Product) private productRepo: Repository<Product>,
  ) {}

  async initiate(userId: string, productId: string, offeredPrice: number) {
    const product = await this.productRepo.findOne({ where: { id: productId } });
    if (!product) throw new NotFoundException('Product not found');
    if (offeredPrice > product.sellingPrice)
      throw new BadRequestException('Offer exceeds selling price');
    if (offeredPrice < product.minAcceptablePrice)
      throw new BadRequestException('Offer is too low');

    // Check for active negotiation
    const active = await this.negRepo.findOne({
      where: { userId, productId, status: NegotiationStatus.ACTIVE },
    });
    if (active) throw new BadRequestException('Active negotiation exists for this item');

    // Generate counter: midpoint between offer and selling price
    const counterPrice = Math.round((offeredPrice + product.sellingPrice) / 2);

    const negotiation = this.negRepo.create({
      userId,
      productId,
      offeredPrice,
      counterPrice,
      costPrice: product.costPrice,
      sellingPrice: product.sellingPrice,
      minAcceptablePrice: product.minAcceptablePrice,
      status: NegotiationStatus.ACTIVE,
      messageHistory: [{
        role: 'user',
        message: `Offered ₦${offeredPrice.toLocaleString()}`,
        price: offeredPrice,
        timestamp: new Date().toISOString(),
      }, {
        role: 'bot',
        message: `Counter offer: ₦${counterPrice.toLocaleString()}`,
        price: counterPrice,
        timestamp: new Date().toISOString(),
      }],
    });

    return this.negRepo.save(negotiation);
  }

  async counter(userId: string, negotiationId: string, newPrice: number) {
    const neg = await this.negRepo.findOne({
      where: { id: negotiationId, userId, status: NegotiationStatus.ACTIVE },
    });
    if (!neg) throw new NotFoundException('Active negotiation not found');

    if (newPrice > neg.sellingPrice || newPrice < neg.minAcceptablePrice)
      throw new BadRequestException(`Price must be between ₦${neg.minAcceptablePrice} and ₦${neg.sellingPrice}`);

    neg.round += 1;
    neg.offeredPrice = newPrice;

    // Simple counter logic: 75% of the gap from offer to selling price
    const gap = neg.sellingPrice - newPrice;
    const newCounter = Math.round(newPrice + gap * 0.5);
    neg.counterPrice = Math.max(newCounter, neg.minAcceptablePrice);

    neg.messageHistory.push({
      role: 'user',
      message: `Countered with ₦${newPrice.toLocaleString()}`,
      price: newPrice,
      timestamp: new Date().toISOString(),
    }, {
      role: 'bot',
      message: `New offer: ₦${neg.counterPrice.toLocaleString()}`,
      price: neg.counterPrice,
      timestamp: new Date().toISOString(),
    });

    // Auto-accept if within 5% of each other
    if (Math.abs(newPrice - neg.counterPrice) / neg.sellingPrice <= 0.05) {
      neg.status = NegotiationStatus.ACCEPTED;
      neg.acceptedPrice = Math.min(newPrice, neg.counterPrice);
      neg.acceptedAt = new Date();
      this.logger.log(`Negotiation ${negotiationId} auto-accepted at ₦${neg.acceptedPrice}`);
    }

    return this.negRepo.save(neg);
  }

  async acceptPrice(userId: string, negotiationId: string, price: number) {
    const neg = await this.negRepo.findOne({
      where: { id: negotiationId, userId, status: NegotiationStatus.ACTIVE },
    });
    if (!neg) throw new NotFoundException('Active negotiation not found');

    neg.status = NegotiationStatus.ACCEPTED;
    neg.acceptedPrice = price;
    neg.acceptedAt = new Date();
    neg.messageHistory.push({
      role: 'user',
      message: `Accepted price: ₦${price.toLocaleString()}`,
      price,
      timestamp: new Date().toISOString(),
    });

    return this.negRepo.save(neg);
  }

  async findByUser(userId: string) {
    return this.negRepo.find({
      where: { userId },
      relations: {
  product: true
},
      order: { updatedAt: 'DESC' },
    });
  }

  async findOne(id: string) {
    const neg = await this.negRepo.findOne({ where: { id }, relations: {
  product: {
    vendor: true
  }
} });
    if (!neg) throw new NotFoundException('Negotiation not found');
    return neg;
  }
}
