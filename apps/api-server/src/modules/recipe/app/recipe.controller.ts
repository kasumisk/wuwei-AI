import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { AppJwtAuthGuard } from '../../auth/app/app-jwt-auth.guard';
import { CurrentAppUser } from '../../auth/app/current-app-user.decorator';
import { AppUserPayload } from '../../auth/app/app-user-payload.type';
import { ApiResponse } from '../../../common/types/response.type';
import { RecipeService } from './recipe.service';
import {
  SearchRecipesDto,
  SubmitRecipeDto,
  RateRecipeDto,
} from './dto/recipe.dto';

/**
 * V6.3 P2-6: App 端菜谱查询接口
 *
 * 路由前缀: /api/app/food/recipes
 * 需要登录
 */
@ApiTags('App 菜谱')
@Controller('app/food/recipes')
@UseGuards(AppJwtAuthGuard)
@ApiBearerAuth()
export class RecipeController {
  constructor(private readonly recipeService: RecipeService) {}

  /**
   * 搜索菜谱
   * GET /api/app/food/recipes
   */
  @Get()
  @ApiOperation({ summary: '搜索菜谱' })
  async search(@Query() query: SearchRecipesDto): Promise<ApiResponse> {
    const result = await this.recipeService.search(query);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取成功',
      data: result,
    };
  }

  /**
   * 获取菜谱详情
   * GET /api/app/food/recipes/:id
   */
  @Get(':id')
  @ApiOperation({ summary: '获取菜谱详情' })
  async findById(@Param('id') id: string): Promise<ApiResponse> {
    const recipe = await this.recipeService.findById(id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取成功',
      data: recipe,
    };
  }

  /**
   * V6.3 P3-4: 用户提交 UGC 菜谱
   * POST /api/app/food/recipes/submit
   */
  @Post('submit')
  @ApiOperation({ summary: '提交用户菜谱（待审核）' })
  async submit(
    @CurrentAppUser() user: AppUserPayload,
    @Body() dto: SubmitRecipeDto,
  ): Promise<ApiResponse> {
    const recipe = await this.recipeService.submitRecipe(user.id, dto);
    return {
      success: true,
      code: HttpStatus.CREATED,
      message: '提交成功，等待审核',
      data: recipe,
    };
  }

  // ── V6.5 Phase 2M: 用户评分接口 ──

  /**
   * 提交/更新菜谱评分（同一菜谱仅保留一条）
   * POST /api/app/food/recipes/:id/rate
   */
  @Post(':id/rate')
  @ApiOperation({ summary: '提交菜谱评分' })
  async rate(
    @CurrentAppUser() user: AppUserPayload,
    @Param('id') id: string,
    @Body() dto: RateRecipeDto,
  ): Promise<ApiResponse> {
    const rating = await this.recipeService.rateRecipe(user.id, id, dto);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '评分成功',
      data: rating,
    };
  }

  /**
   * 获取我对某菜谱的评分
   * GET /api/app/food/recipes/:id/my-rating
   */
  @Get(':id/my-rating')
  @ApiOperation({ summary: '获取我的评分' })
  async getMyRating(
    @CurrentAppUser() user: AppUserPayload,
    @Param('id') id: string,
  ): Promise<ApiResponse> {
    const rating = await this.recipeService.getMyRating(user.id, id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取成功',
      data: rating,
    };
  }

  /**
   * 获取菜谱评分汇总（平均分、分布）
   * GET /api/app/food/recipes/:id/ratings
   */
  @Get(':id/ratings')
  @ApiOperation({ summary: '获取菜谱评分汇总' })
  async getRatingSummary(@Param('id') id: string): Promise<ApiResponse> {
    const summary = await this.recipeService.getRatingSummary(id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取成功',
      data: summary,
    };
  }

  /**
   * 删除我对某菜谱的评分
   * DELETE /api/app/food/recipes/:id/rate
   */
  @Delete(':id/rate')
  @ApiOperation({ summary: '删除我的评分' })
  async deleteRating(
    @CurrentAppUser() user: AppUserPayload,
    @Param('id') id: string,
  ): Promise<ApiResponse> {
    const deleted = await this.recipeService.deleteRating(user.id, id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: deleted ? '删除成功' : '无评分记录',
      data: { deleted },
    };
  }
}
