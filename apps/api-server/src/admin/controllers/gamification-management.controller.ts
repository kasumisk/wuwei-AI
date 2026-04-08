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
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { RolesGuard } from '../guards/roles.guard';
import { Roles } from '../decorators/roles.decorator';
import { ContentManagementService } from '../services/content-management.service';
import {
  GetAchievementsQueryDto,
  CreateAchievementDto,
  UpdateAchievementDto,
  GetChallengesQueryDto,
  CreateChallengeDto,
  UpdateChallengeDto,
} from '../dto/content-management.dto';
import { ApiResponse } from '../../common/types/response.type';

@ApiTags('管理后台 - 成就 & 挑战管理')
@Controller('admin/gamification')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'super_admin')
@ApiBearerAuth()
export class GamificationManagementController {
  constructor(
    private readonly contentService: ContentManagementService,
  ) {}

  // ==================== 成就管理 ====================

  @Get('achievements')
  @ApiOperation({ summary: '获取成就列表' })
  async findAchievements(@Query() query: GetAchievementsQueryDto): Promise<ApiResponse> {
    const data = await this.contentService.findAchievements(query);
    return { success: true, code: HttpStatus.OK, message: '获取成功', data };
  }

  @Post('achievements')
  @ApiOperation({ summary: '创建成就' })
  async createAchievement(@Body() dto: CreateAchievementDto): Promise<ApiResponse> {
    const data = await this.contentService.createAchievement(dto);
    return { success: true, code: HttpStatus.CREATED, message: '创建成功', data };
  }

  @Put('achievements/:id')
  @ApiOperation({ summary: '更新成就' })
  async updateAchievement(@Param('id') id: string, @Body() dto: UpdateAchievementDto): Promise<ApiResponse> {
    const data = await this.contentService.updateAchievement(id, dto);
    return { success: true, code: HttpStatus.OK, message: '更新成功', data };
  }

  @Delete('achievements/:id')
  @ApiOperation({ summary: '删除成就' })
  async deleteAchievement(@Param('id') id: string): Promise<ApiResponse> {
    const data = await this.contentService.deleteAchievement(id);
    return { success: true, code: HttpStatus.OK, message: data.message, data };
  }

  // ==================== 挑战管理 ====================

  @Get('challenges')
  @ApiOperation({ summary: '获取挑战列表' })
  async findChallenges(@Query() query: GetChallengesQueryDto): Promise<ApiResponse> {
    const data = await this.contentService.findChallenges(query);
    return { success: true, code: HttpStatus.OK, message: '获取成功', data };
  }

  @Post('challenges')
  @ApiOperation({ summary: '创建挑战' })
  async createChallenge(@Body() dto: CreateChallengeDto): Promise<ApiResponse> {
    const data = await this.contentService.createChallenge(dto);
    return { success: true, code: HttpStatus.CREATED, message: '创建成功', data };
  }

  @Put('challenges/:id')
  @ApiOperation({ summary: '更新挑战' })
  async updateChallenge(@Param('id') id: string, @Body() dto: UpdateChallengeDto): Promise<ApiResponse> {
    const data = await this.contentService.updateChallenge(id, dto);
    return { success: true, code: HttpStatus.OK, message: '更新成功', data };
  }

  @Post('challenges/:id/toggle-active')
  @ApiOperation({ summary: '切换挑战启用状态' })
  async toggleChallengeActive(@Param('id') id: string): Promise<ApiResponse> {
    const data = await this.contentService.toggleChallengeActive(id);
    return { success: true, code: HttpStatus.OK, message: '状态已更新', data };
  }

  @Delete('challenges/:id')
  @ApiOperation({ summary: '删除挑战' })
  async deleteChallenge(@Param('id') id: string): Promise<ApiResponse> {
    const data = await this.contentService.deleteChallenge(id);
    return { success: true, code: HttpStatus.OK, message: data.message, data };
  }
}
