import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().default(3000),
  DB_HOST: Joi.string().default('localhost'),
  DB_PORT: Joi.number().default(5432),
  DB_USERNAME: Joi.string().default('postgres'),
  DB_PASSWORD: Joi.string().allow('').default(''),
  DB_DATABASE: Joi.string().default('wuwei_ai'),
  DB_SSL: Joi.string().default('false'),
  DB_SYNCHRONIZE: Joi.string().default('false'),
  JWT_SECRET: Joi.string().optional(),
  JWT_APP_SECRET: Joi.string().optional(),
  JWT_ADMIN_SECRET: Joi.string().optional(),
  OPENROUTER_API_KEY: Joi.string().optional(),
  STORAGE_ENDPOINT: Joi.string().optional(),
  STORAGE_ACCESS_KEY: Joi.string().optional(),
  STORAGE_SECRET_KEY: Joi.string().optional(),
}).unknown(true);
