import { Injectable, Inject } from "@nestjs/common";
import { Pool } from "pg";
import Decimal from "decimal.js";

export type ExpenseCategorySummary = {
  categoryId: number;
  categoryName: string;
  total: string;
  transactionCount: number;
  percentage: string;
};

export type ExpenseSummary = {
  totalSpend: string;
  transactionCount: number;
  categories: ExpenseCategorySummary[];
};

export type ExpenseDetailRow = {
  id: number;
  date: string;
  description: string;
  amount: string;
};

type CategoryTotalRow = {
  category_id: number;
  category_name: string;
  total: string;
  transaction_count: string;
};

// Every query here filters status = 'confirmed' (ADR-004 — pending/edited/excluded
// rows must never reach reports) AND transfer_type IS NULL (ADR-026 — CC bill
// payments, household transfers, and investment-platform debits are not spend).
@Injectable()
export class ExpensesService {
  constructor(@Inject("DB_POOL") private readonly pool: Pool) {}

  async getSummary(personId: number, startDate: string, endDate: string): Promise<ExpenseSummary> {
    const result = await this.pool.query<CategoryTotalRow>(
      `SELECT
         ec.id                AS category_id,
         ec.name              AS category_name,
         SUM(e.amount)::text  AS total,
         COUNT(*)::text       AS transaction_count
       FROM expense e
       JOIN expense_category ec ON ec.id = e.category_id
       WHERE e.person_id = $1
         AND e.status = 'confirmed'
         AND e.transfer_type IS NULL
         AND e.date >= $2
         AND e.date <= $3
       GROUP BY ec.id, ec.name
       ORDER BY total DESC`,
      [personId, startDate, endDate],
    );

    const totalSpend = result.rows.reduce((sum, row) => sum.plus(row.total), new Decimal(0));

    const categories: ExpenseCategorySummary[] = result.rows.map((row) => ({
      categoryId: row.category_id,
      categoryName: row.category_name,
      total: row.total,
      transactionCount: parseInt(row.transaction_count, 10),
      percentage: totalSpend.isZero()
        ? "0.00"
        : new Decimal(row.total).div(totalSpend).mul(100).toFixed(2),
    }));

    const transactionCount = categories.reduce((sum, c) => sum + c.transactionCount, 0);

    return { totalSpend: totalSpend.toFixed(4), transactionCount, categories };
  }

  async getDetail(
    personId: number,
    categoryId: number,
    startDate: string,
    endDate: string,
  ): Promise<ExpenseDetailRow[]> {
    const result = await this.pool.query<ExpenseDetailRow>(
      `SELECT
         e.id,
         e.date::text   AS date,
         e.description,
         e.amount::text AS amount
       FROM expense e
       WHERE e.person_id = $1
         AND e.category_id = $2
         AND e.status = 'confirmed'
         AND e.transfer_type IS NULL
         AND e.date >= $3
         AND e.date <= $4
       ORDER BY e.date DESC`,
      [personId, categoryId, startDate, endDate],
    );
    return result.rows;
  }
}
