import { Module } from "@nestjs/common";
import { AssetPriceService } from "./asset-price.service";
import { CurrencyService } from "./currency.service";

@Module({
  providers: [AssetPriceService, CurrencyService],
  exports: [AssetPriceService],
})
export class AssetPriceModule {}
