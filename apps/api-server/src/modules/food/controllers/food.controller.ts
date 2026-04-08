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
import { Public } from '../../../infrastructure/common/decorators/public.decorator';
import { FoodService } from '../services/food.service';
import { SearchFoodDto, CreateFoodDto, UpdateFoodDto } from '../dto/food.dto';

@ApiTags('Food')
@Controller('api/app/food')
export class FoodController {
  constructor(private readonly foodService: FoodService) {}

  @Public()
  @Get('search')
  @ApiOperation({ summary: '搜索食物' })
  search(@Query() dto: SearchFoodDto) {
    return this.foodService.search(dto);
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: '获取食物详情' })
  findById(@Param('id') id: string) {
    return this.foodService.findById(id);
  }

  @Public()
  @Get('code/:code')
  @ApiOperation({ summary: '按编码获取食物' })
  findByCode(@Param('code') code: string) {
    return this.foodService.findByCode(code);
  }
}
