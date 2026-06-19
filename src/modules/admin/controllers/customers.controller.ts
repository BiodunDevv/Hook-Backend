import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query,
  HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { Roles } from '@common/decorators';
import { UserRole } from '@common/constants';
import { success, created } from '@common/dto/api-response.dto';
import { CustomersService } from '../services/customers.service';
import { CreateAdminUserDto, UpdateUserRoleDto } from '../dto/customers.dto';

@ApiTags('Admin')
@ApiBearerAuth()
@Controller('admin/users')
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Get()
  @ApiOperation({ summary: 'List all users with filter & pagination' })
  @ApiQuery({ name: 'role', required: false })
  @ApiQuery({ name: 'search', required: false })
  async getUsers(
    @Query('page') page = 1,
    @Query('limit') limit = 20,
    @Query('role') role?: string,
    @Query('search') search?: string,
  ) {
    return success(await this.customersService.getUsers(page, limit, role, search));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get user details with relationships' })
  async getUser(@Param('id') id: string) {
    return success(await this.customersService.getUserById(id));
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Create a user (admin)' })
  async createUser(@Body() dto: CreateAdminUserDto) {
    return created(await this.customersService.createUser(dto));
  }

  @Patch(':id/toggle')
  @ApiOperation({ summary: 'Activate / deactivate a user' })
  async toggleUser(@Param('id') id: string) {
    return success(await this.customersService.toggleUserStatus(id));
  }

  @Patch(':id/role')
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: "Change a user's role (super admin)" })
  async updateRole(@Param('id') id: string, @Body() dto: UpdateUserRoleDto) {
    return success(await this.customersService.updateUserRole(id, dto.role));
  }
}
