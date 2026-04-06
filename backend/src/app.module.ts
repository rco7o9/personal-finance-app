import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { DatabaseModule } from "./database/database.module";
import { PersonsModule } from "./persons/persons.module";
import { InvestmentsModule } from "./investments/investments.module";
import { ExpensesModule } from "./expenses/expenses.module";
import { StatementsModule } from "./statements/statements.module";
import { IncomeModule } from "./income/income.module";
import { CategoriesModule } from "./categories/categories.module";

@Module({
  imports: [
    // ConfigModule.forRoot() loads .env into process.env automatically.
    // isGlobal: true means you don't need to import ConfigModule in every feature module.
    ConfigModule.forRoot({ isGlobal: true }),

    // DatabaseModule is @Global, so the DB_POOL provider is available
    // everywhere without re-importing this module.
    DatabaseModule,

    // Feature modules — one per domain
    PersonsModule,
    InvestmentsModule,
    ExpensesModule,
    StatementsModule,
    IncomeModule,
    CategoriesModule,
  ],
})
export class AppModule {}
