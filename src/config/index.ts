// src/config/index.ts
import dotenv from 'dotenv';
import { AppConfig } from '../types';

dotenv.config();

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`❌ Variable de entorno requerida no definida: ${key}`);
  }
  return value;
}

export const config: AppConfig = {
  port: parseInt(process.env.PORT ?? '3000', 10),
  username: requireEnv('ASM_USERNAME'),
  password: requireEnv('ASM_PASSWORD'),
  baseUrl: requireEnv('ASM_BASE_URL'),
  loginUrl: requireEnv('ASM_LOGIN_URL'),
  shopUrl: requireEnv('ASM_SHOP_URL'),
  headless: process.env.ASM_HEADLESS !== 'false',
  loginTimeout: parseInt(process.env.ASM_LOGIN_TIMEOUT ?? '30000', 10),
  requestTimeout: parseInt(process.env.ASM_REQUEST_TIMEOUT ?? '30000', 10),
  maxRetries: parseInt(process.env.ASM_MAX_RETRIES ?? '3', 10),
};
