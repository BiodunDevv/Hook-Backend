import type { MongoRepository as Repository } from '@lib/mongo-repository';
import { NegotiationStatus } from '@lib/constants';
import { Negotiation } from '@models/negotiations/negotiation.model';
import { Product } from '@models/products/product.model';
import { HttpError } from '@utils/http';

export class NegotiationService {
  constructor(
    private readonly negotiations: Repository<Negotiation>,
    private readonly products: Repository<Product>,
  ) {}

  async start(userId: string, productId: string, offeredPrice: number, message?: string) {
    const product = await this.products.findOne({ where: { id: productId } });
    if (!product) throw new HttpError(404, 'Product not found');
    const counterPrice = Math.max(product.minAcceptablePrice, Math.round((product.sellingPrice + offeredPrice) / 2));
    const accepted = offeredPrice >= product.minAcceptablePrice;

    const negotiation = await this.negotiations.save(this.negotiations.create({
      userId,
      productId,
      round: 1,
      offeredPrice,
      counterPrice,
      acceptedPrice: accepted ? offeredPrice : undefined,
      status: accepted ? NegotiationStatus.ACCEPTED : NegotiationStatus.ACTIVE,
      costPrice: product.costPrice,
      sellingPrice: product.sellingPrice,
      minAcceptablePrice: product.minAcceptablePrice,
      acceptedAt: accepted ? new Date() : undefined,
      messageHistory: [
        { role: 'user', message: message || `Offer ${offeredPrice}`, price: offeredPrice, timestamp: new Date().toISOString() },
        {
          role: 'bot',
          message: accepted ? 'Offer accepted.' : `Best counter is ${counterPrice}.`,
          price: accepted ? offeredPrice : counterPrice,
          timestamp: new Date().toISOString(),
        },
      ],
    }));
    return negotiation;
  }

  async counter(userId: string, id: string, offeredPrice: number, message?: string) {
    const negotiation = await this.negotiations.findOne({ where: { id, userId }, relations: { product: true } });
    if (!negotiation) throw new HttpError(404, 'Negotiation not found');
    if (negotiation.status !== NegotiationStatus.ACTIVE) throw new HttpError(400, 'Negotiation is already closed');

    negotiation.round += 1;
    negotiation.offeredPrice = offeredPrice;
    negotiation.counterPrice = Math.max(negotiation.minAcceptablePrice, Math.round((negotiation.counterPrice + offeredPrice) / 2));
    const accepted = offeredPrice >= negotiation.minAcceptablePrice || negotiation.round >= 4;
    negotiation.status = accepted ? NegotiationStatus.ACCEPTED : NegotiationStatus.ACTIVE;
    negotiation.acceptedPrice = accepted ? offeredPrice : undefined;
    negotiation.acceptedAt = accepted ? new Date() : undefined;
    negotiation.messageHistory = [
      ...negotiation.messageHistory,
      { role: 'user', message: message || `Offer ${offeredPrice}`, price: offeredPrice, timestamp: new Date().toISOString() },
      {
        role: 'bot',
        message: accepted ? 'Offer accepted.' : `Best counter is ${negotiation.counterPrice}.`,
        price: accepted ? offeredPrice : negotiation.counterPrice,
        timestamp: new Date().toISOString(),
      },
    ];
    return this.negotiations.save(negotiation);
  }

  async list(userId: string) {
    return this.negotiations.find({
      where: { userId },
      relations: { product: true },
      order: { updatedAt: 'DESC' },
    });
  }

  async detail(userId: string, id: string) {
    const negotiation = await this.negotiations.findOne({
      where: { id, userId },
      relations: { product: true },
    });
    if (!negotiation) throw new HttpError(404, 'Negotiation not found');
    return negotiation;
  }

  async accept(userId: string, id: string) {
    const negotiation = await this.detail(userId, id);
    if (negotiation.status !== NegotiationStatus.ACTIVE) throw new HttpError(400, 'Negotiation is already closed');
    negotiation.status = NegotiationStatus.ACCEPTED;
    negotiation.acceptedPrice = negotiation.counterPrice;
    negotiation.acceptedAt = new Date();
    return this.negotiations.save(negotiation);
  }
}
