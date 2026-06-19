import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  HttpCode,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiHeader } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Roles } from '@common/decorators';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { UserRole, SettlementStatus } from '@common/constants';
import { success } from '@common/dto/api-response.dto';
import { FinancialsService } from '../services/financials.service';
import {
  FinancialsQueryDto,
  SettlementsQueryDto,
  TriggerSettlementDto,
} from '../dto/financials.dto';
import { Request } from 'express';

@ApiTags('Admin')
@ApiBearerAuth()
@Controller('admin/financials')
@Roles(UserRole.SUPER_ADMIN) // Only super_admin can access financial endpoints
export class FinancialsController {
  constructor(private readonly financialsService: FinancialsService) {}

  @Get()
  @Throttle({ default: { ttl: 60000, limit: 20 } }) // Stricter rate limit: 20 req/min
  @ApiOperation({
    summary: '[SUPER ADMIN] Get financial dashboard — GMV, commissions, revenue',
  })
  @ApiHeader({
    name: 'X-Idempotency-Key',
    required: false,
    description: 'Optional idempotency key for read operations',
  })
  async getFinancials(
    @Query() query: FinancialsQueryDto,
    @CurrentUser('sub') userId: string,
    @CurrentUser('email') email: string,
    @CurrentUser('role') role: string,
    @Req() req: Request,
  ) {
    return success(
      await this.financialsService.getFinancials(
        {
          id: userId,
          email: email || 'unknown',
          role,
          ip: req.ip,
        },
        query.from,
        query.to,
        query.maxDays,
      ),
    );
  }

  @Get('settlements')
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  @ApiOperation({
    summary: '[SUPER ADMIN] Get vendor settlement records with pagination',
  })
  async getSettlements(
    @Query() query: SettlementsQueryDto,
    @CurrentUser('sub') userId: string,
    @CurrentUser('email') email: string,
    @CurrentUser('role') role: string,
    @Req() req: Request,
  ) {
    return success(
      await this.financialsService.getSettlements(
        { id: userId, email: email || 'unknown', role, ip: req.ip },
        query.page,
        query.limit,
        query.status as SettlementStatus,
      ),
    );
  }

  @Post('settlements/trigger/:vendorId')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60000, limit: 5 } }) // Very strict: 5 req/min
  @ApiOperation({
    summary:
      '[SUPER ADMIN] Manually trigger vendor payout — idempotent, audited',
  })
  @ApiHeader({
    name: 'X-Idempotency-Key',
    required: false,
    description:
      'Idempotency key to prevent duplicate payouts (8-64 alphanumeric chars)',
  })
  async triggerSettlement(
    @Param('vendorId') vendorId: string,
    @Body() dto: TriggerSettlementDto,
    @CurrentUser('sub') userId: string,
    @CurrentUser('email') email: string,
    @CurrentUser('role') role: string,
    @Req() req: Request,
  ) {
    const idempotencyKey =
      dto.idempotencyKey || (req.headers['x-idempotency-key'] as string);

    return success(
      await this.financialsService.triggerSettlement(
        { id: userId, email: email || 'unknown', role, ip: req.ip },
        vendorId,
        idempotencyKey,
        dto.reason,
      ),
    );
  }
}
