import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { SearchService } from './search.service';
import { Public } from '@common/decorators';
import { success } from '@common/dto/api-response.dto';

@ApiTags('Search')
@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Search products & vendors' })
  async search(@Query('q') query: string, @Query('page') page = 1, @Query('limit') limit = 20) {
    return success(await this.searchService.searchAll(query, page, limit));
  }

  @Public()
  @Get('suggestions')
  @ApiOperation({ summary: 'Get search suggestions' })
  async suggestions(@Query('q') query: string) {
    return success(await this.searchService.searchSuggestions(query));
  }
}
