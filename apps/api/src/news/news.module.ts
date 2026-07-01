import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { NewsController } from './news.controller';
import { NewsService } from './news.service';

@Module({
  imports: [AiModule],
  controllers: [NewsController],
  providers: [NewsService],
  exports: [NewsService],
})
export class NewsModule {}
