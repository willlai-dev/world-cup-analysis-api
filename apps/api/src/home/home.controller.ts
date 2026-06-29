import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import type { HomeHighlightsResponse } from '../common/dto/contracts';
import { HomeService } from './home.service';

@ApiTags('home')
@Controller('home')
export class HomeController {
  constructor(private readonly home: HomeService) {}

  @Public()
  @Get('highlights')
  getHighlights(): Promise<HomeHighlightsResponse> {
    return this.home.getHighlights();
  }
}
