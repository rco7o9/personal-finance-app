import { Controller, Get, Query, ParseIntPipe } from "@nestjs/common";
import { ExpensesService } from "./expenses.service";

@Controller("expenses")
export class ExpensesController {
  constructor(private readonly expensesService: ExpensesService) {}

  // GET /expenses/summary?personId=1&startDate=2026-07-01&endDate=2026-07-31
  @Get("summary")
  getSummary(
    @Query("personId", ParseIntPipe) personId: number,
    @Query("startDate") startDate: string,
    @Query("endDate") endDate: string,
  ) {
    return this.expensesService.getSummary(personId, startDate, endDate);
  }

  // GET /expenses?personId=1&categoryId=3&startDate=2026-07-01&endDate=2026-07-31
  @Get()
  getDetail(
    @Query("personId", ParseIntPipe) personId: number,
    @Query("categoryId", ParseIntPipe) categoryId: number,
    @Query("startDate") startDate: string,
    @Query("endDate") endDate: string,
  ) {
    return this.expensesService.getDetail(personId, categoryId, startDate, endDate);
  }
}
