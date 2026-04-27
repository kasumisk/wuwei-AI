import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpStatus,
} from '@nestjs/common';
import { I18n, I18nContext } from '../../../core/i18n/i18n.decorator';
import { JwtAuthGuard } from '../../auth/admin/jwt-auth.guard';
import { RolesGuard } from '../../rbac/admin/roles.guard';
import { Roles } from '../../rbac/admin/roles.decorator';
import { ClientService } from './client.service';
import {
  CreateClientDto,
  UpdateClientDto,
  GetClientsQueryDto,
  GetClientUsageQueryDto,
} from './dto/client-management.dto';
import { ApiResponse } from '../../../common/types/response.type';

@Controller('admin/clients')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class ClientController {
  constructor(private readonly clientService: ClientService) {}

  @Get()
  async findAll(
    @Query() query: GetClientsQueryDto,
    @I18n() i18n: I18nContext,
  ): Promise<ApiResponse> {
    const data = await this.clientService.findAll(query);
    return {
      success: true,
      code: HttpStatus.OK,
      message: i18n.t('client.client.fetchListSuccess'),
      data,
    };
  }

  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @I18n() i18n: I18nContext,
  ): Promise<ApiResponse> {
    const data = await this.clientService.findOne(id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: i18n.t('client.client.fetchDetailSuccess'),
      data,
    };
  }

  @Post()
  async create(
    @Body() createClientDto: CreateClientDto,
    @I18n() i18n: I18nContext,
  ): Promise<ApiResponse> {
    const data = await this.clientService.create(createClientDto);
    return {
      success: true,
      code: HttpStatus.CREATED,
      message: i18n.t('client.client.createSuccess'),
      data,
    };
  }

  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() updateClientDto: UpdateClientDto,
    @I18n() i18n: I18nContext,
  ): Promise<ApiResponse> {
    const data = await this.clientService.update(id, updateClientDto);
    return {
      success: true,
      code: HttpStatus.OK,
      message: i18n.t('client.client.updateSuccess'),
      data,
    };
  }

  @Delete(':id')
  async remove(
    @Param('id') id: string,
    @I18n() i18n: I18nContext,
  ): Promise<ApiResponse> {
    const data = await this.clientService.remove(id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: i18n.t('client.client.deleteSuccess'),
      data,
    };
  }

  @Post(':id/regenerate-secret')
  async regenerateSecret(
    @Param('id') id: string,
    @I18n() i18n: I18nContext,
  ): Promise<ApiResponse> {
    const data = await this.clientService.regenerateSecret(id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: i18n.t('client.client.regenerateSecretSuccess'),
      data,
    };
  }

  @Get(':id/usage')
  async getUsageStats(
    @Param('id') id: string,
    @Query() query: GetClientUsageQueryDto,
    @I18n() i18n: I18nContext,
  ): Promise<ApiResponse> {
    const data = await this.clientService.getUsageStats(id, query);
    return {
      success: true,
      code: HttpStatus.OK,
      message: i18n.t('client.client.usageStatsSuccess'),
      data,
    };
  }
}
