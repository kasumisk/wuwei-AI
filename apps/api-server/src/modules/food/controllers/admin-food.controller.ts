import {
  Controller,
  Get,
  Post,
  Put,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AdminJwtAuthGuard } from '../../auth/guards/admin-jwt-auth.guard';
import { FoodService } from '../services/food.service';
import { SearchFoodDto, CreateFoodDto, UpdateFoodDto } from '../dto/food.dto';

@ApiTags('Admin Food')
@ApiBearerAuth('admin-jwt')
@UseGuards(AdminJwtAuthGuard)
@Controller('api/admin/food')
export class AdminFoodController {
  constructor(private readonly foodService: FoodService) {}

  @Get('search')
  @ApiOperation({ summary: '管理端搜索食物' })
  search(@Query() dto: SearchFoodDto) {
    return this.foodService.search(dto);
  }

  @Get(':id')
  @ApiOperation({ summary: '管理端获取食物详情' })
  findById(@Param('id') id: string) {
    return this.foodService.findById(id);
  }

  @Post()
  @ApiOperation({ summary: '创建食物' })
  create(@Body() dto: CreateFoodDto) {
    return this.foodService.create(dto);
  }

  @Put(':id')
  @ApiOperation({ summary: '更新食物' })
  update(@Param('id') id: string, @Body() dto: UpdateFoodDto) {
    return this.foodService.update(id, dto);
  }
}
