import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Query,
  Body,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { ApiResponse } from '../../../common/types/response.type';
import { FoodLibraryService } from './food-library.service';

/**
 * 食物库公开查询接口
 * 路由前缀: /api/foods
 * 无需登录即可访问（SEO 落地页数据源）
 */
@ApiTags('食物库（公开）')
@Controller('foods')
export class FoodLibraryController {
  constructor(private readonly foodLibraryService: FoodLibraryService) {}

  /**
   * 搜索食物
   * GET /api/foods/search?q=宫保鸡丁&limit=10
   */
  @Get('search')
  @ApiOperation({ summary: '搜索食物' })
  @ApiQuery({ name: 'q', required: true, description: '搜索关键词' })
  @ApiQuery({ name: 'limit', required: false, description: '返回条数，默认10' })
  async search(
    @Query('q') q: string,
    @Query('limit') limit?: string,
  ): Promise<ApiResponse> {
    if (!q || q.trim().length === 0) {
      return {
        success: true,
        code: HttpStatus.OK,
        message: '请输入搜索关键词',
        data: { items: [], total: 0 },
      };
    }

    const items = (await this.foodLibraryService.search(
      q.trim(),
      limit ? parseInt(limit, 10) : 10,
    )) as any[];

    return {
      success: true,
      code: HttpStatus.OK,
      message: '搜索成功',
      data: { items, total: items.length },
    };
  }

  /**
   * 热门/分类食物
   * GET /api/foods/popular?category=主食&limit=20
   */
  @Get('popular')
  @ApiOperation({ summary: '获取热门食物' })
  @ApiQuery({ name: 'category', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async popular(
    @Query('category') category?: string,
    @Query('limit') limit?: string,
  ): Promise<ApiResponse> {
    const items = await this.foodLibraryService.getPopular(
      category,
      limit ? parseInt(limit, 10) : 20,
    );

    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取成功',
      data: items,
    };
  }

  /**
   * 获取食物分类列表
   * GET /api/foods/categories
   */
  @Get('categories')
  @ApiOperation({ summary: '获取食物分类列表' })
  async categories(): Promise<ApiResponse> {
    const categories = await this.foodLibraryService.getCategories();
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取成功',
      data: categories,
    };
  }

  /**
   * 获取所有食物（供 sitemap 等使用）
   * GET /api/foods?limit=500
   */
  @Get()
  @ApiOperation({ summary: '获取所有食物（分页）' })
  @ApiQuery({ name: 'limit', required: false })
  async findAll(@Query('limit') limit?: string): Promise<ApiResponse> {
    const data = await this.foodLibraryService.findAll(
      limit ? parseInt(limit, 10) : 500,
    );
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取成功',
      data,
    };
  }

  /**
   * 按名称获取食物详情（SEO 落地页数据接口）
   * GET /api/foods/by-name/:name
   */
  @Get('by-name/:name')
  @ApiOperation({ summary: '按名称获取食物详情' })
  async findByName(@Param('name') name: string): Promise<ApiResponse> {
    const food = await this.foodLibraryService.findByName(
      decodeURIComponent(name),
    );
    const related = await this.foodLibraryService.getRelated(food.name, 5);

    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取成功',
      data: { ...food, related },
    };
  }

  /**
   * 按 ID 获取食物详情
   * GET /api/foods/:id
   */
  @Get(':id')
  @ApiOperation({ summary: '按ID获取食物详情' })
  async findById(@Param('id') id: string): Promise<ApiResponse> {
    const food = await this.foodLibraryService.findById(id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取成功',
      data: food,
    };
  }
}
