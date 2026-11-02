import { Module } from '@nestjs/common';
import { PublicHostelsController } from './public-hostels.controller';

@Module({
  controllers: [PublicHostelsController],
})
export class PublicHostelsModule {}
