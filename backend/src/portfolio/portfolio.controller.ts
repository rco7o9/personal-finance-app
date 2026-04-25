import { Controller, Get, Param, Post, ParseIntPipe } from "@nestjs/common";
import { PortfolioService } from "./portfolio.service";

@Controller("portfolio")
export class PortfolioController {
  constructor(private readonly portfolioService: PortfolioService) {}

  @Get("summary")
  getSummary() {
    return this.portfolioService.getSummary();
  }

  @Get("assets")
  getAssets() {
    return this.portfolioService.getAssets();
  }

  @Get("assets/:assetId")
  getAssetDetail(@Param("assetId", ParseIntPipe) assetId: number) {
    return this.portfolioService.getAssetDetail(assetId);
  }

  @Post("holdings/refresh")
  refreshHoldingPrices() {
    return this.portfolioService.refreshHoldingPrices();
  }
}
