import { Controller, Get, Param, Query, ParseIntPipe } from "@nestjs/common";
import { PortfolioService } from "./portfolio.service";

@Controller("portfolio")
export class PortfolioController {
  constructor(private readonly portfolioService: PortfolioService) {}

  @Get("summary")
  getSummary(@Query("personId", ParseIntPipe) personId: number) {
    return this.portfolioService.getSummary(personId);
  }

  @Get("assets")
  getAssets(@Query("personId", ParseIntPipe) personId: number) {
    return this.portfolioService.getAssets(personId);
  }

  @Get("assets/:assetId")
  getAssetDetail(
    @Param("assetId", ParseIntPipe) assetId: number,
    @Query("personId", ParseIntPipe) personId: number,
  ) {
    return this.portfolioService.getAssetDetail(assetId, personId);
  }
}
