import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { buildPaginationMeta, Paginated } from '../common/dto/api-response.types';
import { ChatQuestionDto } from '../common/dto/chat.dto';
import type { ChatAnswerDto, NewsSummary } from '../common/dto/contracts';
import { NonAdminUserGuard } from '../common/guards/non-admin-user.guard';
import { PremiumOnlyGuard } from '../common/guards/premium-only.guard';
import { buildMockChatAnswer } from '../common/utils/ai-mock.util';
import { ListNewsQueryDto } from './dto/list-news-query.dto';
import { type NewsDetailDto, NewsService } from './news.service';

@ApiTags('news')
@Controller('news')
@UseGuards(NonAdminUserGuard)
export class NewsController {
  constructor(private readonly news: NewsService) {}

  @Get()
  async list(@Query() query: ListNewsQueryDto): Promise<Paginated<NewsSummary[]>> {
    const { items, total } = await this.news.list(query);
    return new Paginated(items, buildPaginationMeta(query.page, query.pageSize, total));
  }

  @Get(':newsId')
  getOne(@Param('newsId') newsId: string): Promise<NewsDetailDto> {
    return this.news.getById(newsId);
  }

  @Post(':newsId/translate')
  @HttpCode(200)
  @UseGuards(PremiumOnlyGuard)
  translate(@Param('newsId') newsId: string): Promise<NewsDetailDto> {
    return this.news.translate(newsId);
  }

  @Post(':newsId/deep-chat')
  @UseGuards(PremiumOnlyGuard)
  async deepChat(
    @Param('newsId') newsId: string,
    @Body() dto: ChatQuestionDto,
  ): Promise<ChatAnswerDto> {
    const news = await this.news.getById(newsId);
    return buildMockChatAnswer(dto.question, {
      scope: `新聞：${news.titleEn}`,
      sourceUpdatedAt: news.publishedAt,
    });
  }
}
