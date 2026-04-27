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
  Request,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/admin/jwt-auth.guard';
import { RolesGuard } from '../../rbac/admin/roles.guard';
import { Roles } from '../../rbac/admin/roles.decorator';
import { ApiResponse } from '../../../common/types/response.type';
import { RecipeManagementService } from './recipe-management.service';
import {
  CreateRecipeDto,
  UpdateRecipeDto,
  GetRecipesQueryDto,
  GenerateRecipesDto,
  ReviewRecipeDto,
  RecalculateScoresDto,
  ImportExternalRecipesDto,
} from './dto/recipe-management.dto';
import { RecipeGenerationService } from '../app/recipe-generation.service';
import { I18nService } from '../../../core/i18n/i18n.service';

/**
 * V6.3 P2-6: 管理后台菜谱管理接口
 *
 * 路由前缀: /api/admin/recipes
 */
@ApiTags('管理后台 - 菜谱管理')
@Controller('admin/recipes')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'super_admin')
@ApiBearerAuth()
export class RecipeManagementController {
  constructor(
    private readonly recipeManagementService: RecipeManagementService,
    private readonly recipeGenerationService: RecipeGenerationService,
    private readonly i18n: I18nService,
  ) {}

  // ==================== 查询 ====================

  @Get()
  @ApiOperation({ summary: '获取菜谱列表' })
  async findAll(@Query() query: GetRecipesQueryDto): Promise<ApiResponse> {
    const data = await this.recipeManagementService.findAll(query);
    return {
      success: true,
      code: HttpStatus.OK,
      message: this.i18n.t('recipe.ok'),
      data,
    };
  }

  @Get('statistics')
  @ApiOperation({ summary: '获取菜谱统计' })
  async getStatistics(): Promise<ApiResponse> {
    const data = await this.recipeManagementService.getStatistics();
    return {
      success: true,
      code: HttpStatus.OK,
      message: this.i18n.t('recipe.ok'),
      data,
    };
  }

  @Post('recalculate-scores')
  @Roles('super_admin')
  @ApiOperation({ summary: 'V6.4: 批量重算菜谱质量评分' })
  async recalculateScores(
    @Body() dto: RecalculateScoresDto,
  ): Promise<ApiResponse> {
    const data = await this.recipeManagementService.recalculateAllScores({
      onlyZero: dto.onlyZero,
      batchSize: dto.batchSize,
    });
    return {
      success: true,
      code: HttpStatus.OK,
      message: this.i18n.t('recipe.batchRecalcDone', {
        updated: data.updated,
        unchanged: data.unchanged,
      }),
      data,
    };
  }

  @Get(':id')
  @ApiOperation({ summary: '获取菜谱详情' })
  async findById(@Param('id') id: string): Promise<ApiResponse> {
    const data = await this.recipeManagementService.findById(id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: this.i18n.t('recipe.ok'),
      data,
    };
  }

  // ==================== AI 生成 ====================

  @Post('generate')
  @ApiOperation({ summary: 'AI 批量生成菜谱（≤3同步，>3异步）' })
  async generate(@Body() dto: GenerateRecipesDto): Promise<ApiResponse> {
    const data = await this.recipeGenerationService.generate(dto);
    return {
      success: true,
      code: HttpStatus.CREATED,
      message:
        data.mode === 'sync'
          ? this.i18n.t('recipe.generationDone')
          : this.i18n.t('recipe.generationQueued'),
      data,
    };
  }

  @Post('import-external')
  @ApiOperation({ summary: '导入外卖/食堂菜品数据' })
  async importExternal(
    @Body() dto: ImportExternalRecipesDto,
  ): Promise<ApiResponse> {
    const data = await this.recipeManagementService.importExternalRecipes(dto);
    return {
      success: true,
      code: HttpStatus.CREATED,
      message: this.i18n.t('recipe.importOk'),
      data,
    };
  }

  // ==================== 创建 / 更新 / 删除 ====================

  @Post()
  @ApiOperation({ summary: '创建菜谱' })
  async create(@Body() dto: CreateRecipeDto): Promise<ApiResponse> {
    const data = await this.recipeManagementService.create(dto);
    return {
      success: true,
      code: HttpStatus.CREATED,
      message: this.i18n.t('recipe.createdOk'),
      data,
    };
  }

  @Put(':id')
  @ApiOperation({ summary: '更新菜谱' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateRecipeDto,
  ): Promise<ApiResponse> {
    const data = await this.recipeManagementService.update(id, dto);
    return {
      success: true,
      code: HttpStatus.OK,
      message: this.i18n.t('recipe.updatedOk'),
      data,
    };
  }

  @Put(':id/review')
  @ApiOperation({ summary: '审核用户提交菜谱' })
  async review(
    @Param('id') id: string,
    @Body() dto: ReviewRecipeDto,
    @Request() req: any,
  ): Promise<ApiResponse> {
    const adminUserId = req.user?.id || req.user?.sub;
    const data = await this.recipeManagementService.reviewRecipe(id, {
      action: dto.action,
      note: dto.note,
      adminUserId,
    });
    return {
      success: true,
      code: HttpStatus.OK,
      message: this.i18n.t('recipe.reviewOk'),
      data,
    };
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除菜谱（软删除）' })
  async delete(@Param('id') id: string): Promise<ApiResponse> {
    await this.recipeManagementService.softDelete(id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: this.i18n.t('recipe.deletedOk'),
      data: null,
    };
  }

  // ==================== 翻译管理 ====================

  @Get(':id/translations')
  @ApiOperation({ summary: 'V6.4: 获取菜谱所有翻译' })
  async getTranslations(@Param('id') id: string): Promise<ApiResponse> {
    const data = await this.recipeManagementService.getTranslations(id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: this.i18n.t('recipe.ok'),
      data,
    };
  }

  @Put(':id/translations/:locale')
  @ApiOperation({ summary: 'V6.4: 创建或更新菜谱翻译' })
  async upsertTranslation(
    @Param('id') id: string,
    @Param('locale') locale: string,
    @Body() body: { name: string; description?: string; instructions?: any },
  ): Promise<ApiResponse> {
    const data = await this.recipeManagementService.upsertTranslation({
      recipeId: id,
      locale,
      name: body.name,
      description: body.description,
      instructions: body.instructions,
    });
    return {
      success: true,
      code: HttpStatus.OK,
      message: this.i18n.t('recipe.translationSaved'),
      data,
    };
  }

  @Delete(':id/translations/:locale')
  @ApiOperation({ summary: 'V6.4: 删除菜谱翻译' })
  async deleteTranslation(
    @Param('id') id: string,
    @Param('locale') locale: string,
  ): Promise<ApiResponse> {
    await this.recipeManagementService.deleteTranslation(id, locale);
    return {
      success: true,
      code: HttpStatus.OK,
      message: this.i18n.t('recipe.translationDeleted'),
      data: null,
    };
  }
}
