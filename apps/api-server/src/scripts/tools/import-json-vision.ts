import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { resolve } from 'path';
import { AppModule } from '../../app.module';
import { CnFoodCompositionImporterService } from '../../food-pipeline/services/fetchers/cn-food-composition-importer.service';

async function run() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    const importer = app.get(CnFoodCompositionImporterService);
    const directoryPath =
      process.argv[2] || resolve(__dirname, '../../../../json_data_vision');

    Logger.log(`开始导入 json_data_vision: ${directoryPath}`);
    const summary = await importer.importFromDirectory(directoryPath);

    Logger.log(
      [
        'json_data_vision 导入完成',
        `文件数: ${summary.totalFiles}`,
        `总记录: ${summary.totalRecords}`,
        `导入记录: ${summary.importedRecords}`,
        `结果: 新增 ${summary.importResult.created} / 更新 ${summary.importResult.updated} / 跳过 ${summary.importResult.skipped} / 错误 ${summary.importResult.errors}`,
      ].join('\n'),
    );
  } finally {
    await app.close();
  }
}

run().catch((error) => {
  Logger.error(`json_data_vision 导入失败: ${error.message}`, error.stack);
  process.exit(1);
});
