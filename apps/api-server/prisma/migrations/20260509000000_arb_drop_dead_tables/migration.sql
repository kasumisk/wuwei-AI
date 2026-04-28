-- ARB-2026-04: 删除零引用死表
--
-- document_embeddings  — Langchain 直接用字符串操作，Prisma model 从未被调用
-- food_recommendation_profile — 建表占位，代码层零引用，功能未实现
-- migrations           — TypeORM 遗留的迁移记录表，与 Prisma migrate 体系无关
--
-- 所有表均无外键被其他业务表引用，可直接 DROP。

DROP TABLE IF EXISTS document_embeddings CASCADE;
DROP TABLE IF EXISTS food_recommendation_profile CASCADE;
DROP TABLE IF EXISTS migrations CASCADE;
