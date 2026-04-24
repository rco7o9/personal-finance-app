import { Module } from "@nestjs/common";
import { PortfolioController } from "./portfolio.controller";
import { PortfolioService } from "./portfolio.service";
import { AssetPriceModule } from "../asset-price/asset-price.module";

@Module({
  imports: [AssetPriceModule],
  controllers: [PortfolioController],
  providers: [PortfolioService],
})
export class PortfolioModule {}
