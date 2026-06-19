import { Controller, Post, Get, Param, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { NegotiationService } from './negotiation.service';
import { CurrentUser } from '@common/decorators';
import { success, created } from '@common/dto/api-response.dto';

@ApiTags('Negotiation')
@ApiBearerAuth()
@Controller('negotiate')
export class NegotiationController {
  constructor(private readonly negotiationService: NegotiationService) {}

  @Post('initiate')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Start a price negotiation on a product' })
  async initiate(
    @CurrentUser('sub') userId: string,
    @Body() dto: { productId: string; offeredPrice: number },
  ) {
    return created(
      await this.negotiationService.initiate(userId, dto.productId, dto.offeredPrice),
    );
  }

  @Post(':id/counter')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Counter the AI offer' })
  async counter(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: { counterPrice: number },
  ) {
    return success(await this.negotiationService.counter(userId, id, dto.counterPrice));
  }

  @Post(':id/accept')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Accept the AI counter offer' })
  async accept(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: { acceptedPrice: number },
  ) {
    return success(await this.negotiationService.acceptPrice(userId, id, dto.acceptedPrice));
  }

  @Get()
  @ApiOperation({ summary: 'Get my negotiation history' })
  async myNegotiations(@CurrentUser('sub') userId: string) {
    return success(await this.negotiationService.findByUser(userId));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get negotiation details' })
  async findOne(@Param('id') id: string) {
    return success(await this.negotiationService.findOne(id));
  }
}
