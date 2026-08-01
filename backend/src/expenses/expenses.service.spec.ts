import { ExpensesService } from "./expenses.service";

function makePool(rows: object[]) {
  return { query: jest.fn().mockResolvedValue({ rows, rowCount: rows.length }) } as never;
}

describe("ExpensesService", () => {
  describe("getSummary", () => {
    it("computes percentage share per category and the overall total", async () => {
      const pool = makePool([
        {
          category_id: 1,
          category_name: "Food & Dining",
          total: "750.0000",
          transaction_count: "3",
        },
        { category_id: 2, category_name: "Shopping", total: "250.0000", transaction_count: "1" },
      ]);
      const svc = new ExpensesService(pool);
      const result = await svc.getSummary(1, "2026-07-01", "2026-07-31");

      expect(result.totalSpend).toBe("1000.0000");
      expect(result.transactionCount).toBe(4);
      expect(result.categories).toHaveLength(2);
      expect(result.categories[0]).toMatchObject({
        categoryId: 1,
        categoryName: "Food & Dining",
        total: "750.0000",
        transactionCount: 3,
        percentage: "75.00",
      });
      expect(result.categories[1].percentage).toBe("25.00");
    });

    it("returns zero totals and no division-by-zero error when there is no spend", async () => {
      const pool = makePool([]);
      const svc = new ExpensesService(pool);
      const result = await svc.getSummary(1, "2026-07-01", "2026-07-31");

      expect(result.totalSpend).toBe("0.0000");
      expect(result.transactionCount).toBe(0);
      expect(result.categories).toEqual([]);
    });

    it("scopes the query to the person, confirmed status, non-transfer rows, and the date range", async () => {
      const pool = makePool([]);
      const svc = new ExpensesService(pool);
      await svc.getSummary(7, "2026-01-01", "2026-01-31");

      const [sql, params] = (pool as { query: jest.Mock }).query.mock.calls[0] as [
        string,
        unknown[],
      ];
      expect(sql).toContain("e.person_id = $1");
      expect(sql).toContain("e.status = 'confirmed'");
      expect(sql).toContain("e.transfer_type IS NULL");
      expect(sql).toContain("e.date >= $2");
      expect(sql).toContain("e.date <= $3");
      expect(params).toEqual([7, "2026-01-01", "2026-01-31"]);
    });
  });

  describe("getDetail", () => {
    it("returns rows scoped to person, category, status, and date range", async () => {
      const rows = [
        { id: 10, date: "2026-07-05", description: "Swiggy", amount: "500.0000" },
        { id: 11, date: "2026-07-02", description: "Zomato", amount: "250.0000" },
      ];
      const pool = makePool(rows);
      const svc = new ExpensesService(pool);
      const result = await svc.getDetail(1, 3, "2026-07-01", "2026-07-31");

      expect(result).toEqual(rows);
      const [sql, params] = (pool as { query: jest.Mock }).query.mock.calls[0] as [
        string,
        unknown[],
      ];
      expect(sql).toContain("e.person_id = $1");
      expect(sql).toContain("e.category_id = $2");
      expect(sql).toContain("e.status = 'confirmed'");
      expect(sql).toContain("e.transfer_type IS NULL");
      expect(params).toEqual([1, 3, "2026-07-01", "2026-07-31"]);
    });
  });
});
