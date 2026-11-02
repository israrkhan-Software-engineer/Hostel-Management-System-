import { Module } from '@nestjs/common';
import { Phase6Controller } from './phase6.controller';
import { Phase6Service } from './phase6.service';

@Module({
  controllers: [Phase6Controller],
  providers: [Phase6Service],
})
export class Phase6Module {}
