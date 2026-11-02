/**
 * HMS Worker entry point — Phase 0 placeholder
 * BullMQ job processors are registered in Phase 3 (finance jobs) and later phases.
 * This file exists so the Dockerfile.worker build does not fail.
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrapWorker() {
  const app = await NestFactory.createApplicationContext(AppModule);
  await app.init();
  console.log('HMS Worker started (Phase 0 placeholder — no jobs registered yet)');
  setInterval(() => undefined, 60_000);
}

bootstrapWorker();
