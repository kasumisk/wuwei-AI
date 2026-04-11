import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
// App 端
import { RecipeController } from './app/recipe.controller';
import { RecipeService } from './app/recipe.service';
import { RecipeGenerationService } from './app/recipe-generation.service';
import { RecipeGenerationProcessor } from './app/recipe-generation.processor';
// Admin 端
import { RecipeManagementController } from './admin/recipe-management.controller';
import { RecipeManagementService } from './admin/recipe-management.service';

/**
 * V6.3 P2-6/P2-7: 菜谱模块
 *
 * 提供菜谱 CRUD、搜索、评分、AI 批量生成能力
 * - App 端: 菜谱搜索 + 详情
 * - Admin 端: 菜谱 CRUD + 统计 + 批量创建 + AI 生成
 *
 * exports RecipeService 和 RecipeManagementService
 * 供 DietModule（MealAssembler 菜谱模式）和 AI 批量生成使用
 */
@Module({
  imports: [ConfigModule],
  controllers: [RecipeController, RecipeManagementController],
  providers: [
    RecipeService,
    RecipeManagementService,
    RecipeGenerationService,
    RecipeGenerationProcessor,
  ],
  exports: [RecipeService, RecipeManagementService],
})
export class RecipeModule {}
