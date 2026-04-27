/**
 * I18n V7 — 全局模块
 *
 * 提供：
 *  - I18nService（启动时扫描 modules/common 下所有 i18n/*.json）
 *  - I18nMiddleware（Accept-Language / x-lang / ?lang= → CLS locale）
 *
 * @Global 标注，业务模块无需 import 即可在 controller / service 中：
 *   constructor(private readonly i18n: I18nService) {}
 *   @I18n() i18n: I18nContext  // 在 controller 方法签名上
 */

import { Global, Module } from '@nestjs/common';
import { I18nService } from './i18n.service';
import { I18nMiddleware } from './i18n.middleware';

@Global()
@Module({
  providers: [I18nService, I18nMiddleware],
  exports: [I18nService, I18nMiddleware],
})
export class I18nModule {}
