import { StatementsService } from "./statements.service";
import { HttpException, HttpStatus } from "@nestjs/common";

// --- helpers ---

function makeFile(content: string = "data"): Express.Multer.File {
  return {
    buffer: Buffer.from(content),
    originalname: "test.csv",
    mimetype: "text/csv",
    fieldname: "file",
    encoding: "7bit",
    size: content.length,
    stream: null as never,
    destination: "",
    filename: "",
    path: "",
  };
}

function agentOkResponse(overrides: Partial<object> = {}) {
  return JSON.stringify({
    status: "ok",
    verificationStatus: "skipped",
    transactions: [],
    ...overrides,
  });
}

// --- mock pool builder ---

function makePool(queryResponses: Array<{ rows: object[]; rowCount?: number }>) {
  let callIndex = 0;
  const client = {
    query: jest.fn().mockImplementation(() => {
      const response = queryResponses[callIndex++] ?? { rows: [], rowCount: 0 };
      return Promise.resolve(response);
    }),
    release: jest.fn(),
  };
  return {
    pool: { connect: jest.fn().mockResolvedValue(client), query: jest.fn() } as never,
    client,
  };
}

// --- fetch mock setup ---

function mockFetch(responseBody: string, ok = true) {
  global.fetch = jest.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 502,
    text: () => Promise.resolve(responseBody),
    json: () => Promise.resolve(JSON.parse(responseBody)),
  });
}

// ----------------------------------------------------------------
// Tests
// ----------------------------------------------------------------

describe("StatementsService", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("uploadStatement", () => {
    it("throws BAD_REQUEST for invalid metadata JSON", async () => {
      const { pool } = makePool([]);
      const svc = new StatementsService(pool);
      await expect(svc.uploadStatement(makeFile(), "not-json")).rejects.toMatchObject({
        status: HttpStatus.BAD_REQUEST,
      });
    });

    it("throws BAD_REQUEST for unknown platform", async () => {
      const { pool } = makePool([]);
      const svc = new StatementsService(pool);
      const meta = JSON.stringify({
        type: "investment",
        platform: "unknown-xyz",
        format: "csv",
        personId: 1,
      });
      await expect(svc.uploadStatement(makeFile(), meta)).rejects.toMatchObject({
        status: HttpStatus.BAD_REQUEST,
      });
    });

    it("throws BAD_GATEWAY when agent returns non-ok status", async () => {
      mockFetch("agent error", false);
      const { pool } = makePool([]);
      const svc = new StatementsService(pool);
      const meta = JSON.stringify({
        type: "investment",
        platform: "zerodha",
        format: "csv",
        personId: 1,
      });
      await expect(svc.uploadStatement(makeFile(), meta)).rejects.toMatchObject({
        status: HttpStatus.BAD_GATEWAY,
      });
    });

    it("throws BAD_GATEWAY when agent response has status=error", async () => {
      mockFetch(
        JSON.stringify({
          status: "error",
          error: "parse failed",
          verificationStatus: "skipped",
          transactions: [],
        }),
      );
      const { pool } = makePool([]);
      const svc = new StatementsService(pool);
      const meta = JSON.stringify({
        type: "investment",
        platform: "zerodha",
        format: "csv",
        personId: 1,
      });
      await expect(svc.uploadStatement(makeFile(), meta)).rejects.toMatchObject({
        status: HttpStatus.BAD_GATEWAY,
      });
    });

    it("returns { inserted:0, skipped:0 } when agent returns no matching transactions", async () => {
      mockFetch(
        agentOkResponse({
          transactions: [
            {
              rowType: "expense",
              date: "2026-01-01",
              description: "ATM",
              amount: 100,
              type: "debit",
              confidence: 0.9,
              source_text: "ATM",
            },
          ],
        }),
      );

      // Pool responses for investment type upload (no transactions to insert after filtering):
      // FI lookup, category lookup, currency lookup, dedup query (no BEGIN/COMMIT since loop is empty)
      const { pool } = makePool([
        { rows: [{ id: 3 }], rowCount: 1 }, // FI
        { rows: [{ id: 2 }], rowCount: 1 }, // category
        { rows: [{ id: 1 }], rowCount: 1 }, // currency
        { rows: [], rowCount: 0 }, // dedup fetch
        { rows: [], rowCount: 0 }, // BEGIN
        { rows: [], rowCount: 0 }, // COMMIT
      ]);
      const svc = new StatementsService(pool);
      const meta = JSON.stringify({
        type: "investment",
        platform: "zerodha",
        format: "csv",
        personId: 1,
      });
      const result = await svc.uploadStatement(makeFile(), meta);
      expect(result.inserted).toBe(0);
      expect(result.skipped).toBe(0);
      expect(result.transactions).toEqual([]);
    });
  });

  describe("getPending", () => {
    it("returns investment rows when type=investment", async () => {
      const pendingRow = {
        id: 1,
        date: "2026-01-15",
        assetName: "HDFC Bank",
        platform: "Zerodha",
        categoryName: "Indian Equity",
        quantity: "10.00000000",
        price: "1500.0000",
        nativeCurrency: "INR",
        amountInr: "15000.0000",
        status: "pending",
        confidenceScore: "1.0000",
        verificationStatus: "skipped",
      };
      const pool = {
        query: jest.fn().mockResolvedValue({ rows: [pendingRow], rowCount: 1 }),
      } as never;
      const svc = new StatementsService(pool);
      const rows = await svc.getPending(1, "investment");
      expect(rows).toHaveLength(1);
      expect(rows[0].assetName).toBe("HDFC Bank");
    });

    it("returns expense rows when type=expense", async () => {
      const expenseRow = {
        id: 5,
        date: "2026-01-20",
        assetName: "Swiggy",
        platform: "expense",
        categoryName: "Food",
        quantity: null,
        price: null,
        nativeCurrency: "INR",
        amountInr: "350.0000",
        status: "pending",
        confidenceScore: "0.9500",
        verificationStatus: "passed",
      };
      const pool = {
        query: jest.fn().mockResolvedValue({ rows: [expenseRow], rowCount: 1 }),
      } as never;
      const svc = new StatementsService(pool);
      const rows = await svc.getPending(1, "expense");
      expect(rows).toHaveLength(1);
      expect(rows[0].platform).toBe("expense");
    });
  });

  describe("reviewTransaction", () => {
    it("deletes investment_transaction on reject", async () => {
      const pool = {
        query: jest
          .fn()
          .mockResolvedValueOnce({ rows: [{ asset_id: 5 }], rowCount: 1 }) // SELECT asset_id
          .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // DELETE investment_transaction
          .mockResolvedValueOnce({ rows: [], rowCount: 0 }), // DELETE asset (orphan cleanup, no match)
      } as never;
      const svc = new StatementsService(pool);
      await svc.reviewTransaction(42, "reject");
      expect((pool as { query: jest.Mock }).query).toHaveBeenCalledWith(
        expect.stringContaining("DELETE FROM investment_transaction"),
        [42],
      );
    });

    it("falls back to expense DELETE when investment_transaction row not found", async () => {
      const pool = {
        query: jest
          .fn()
          .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // SELECT asset_id — not pending/not found
          .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // DELETE investment_transaction — not found
          .mockResolvedValueOnce({ rows: [], rowCount: 1 }), // DELETE expense
      } as never;
      const svc = new StatementsService(pool);
      await svc.reviewTransaction(99, "reject");
      const calls = (pool as { query: jest.Mock }).query.mock.calls as [string, unknown[]][];
      expect(calls[2]?.[0]).toContain("DELETE FROM expense");
    });

    it("confirms investment_transaction row", async () => {
      const pool = {
        query: jest.fn().mockResolvedValueOnce({ rows: [], rowCount: 1 }), // UPDATE investment_transaction
      } as never;
      const svc = new StatementsService(pool);
      await svc.reviewTransaction(7, "confirm");
      const calls = (pool as { query: jest.Mock }).query.mock.calls as [string, unknown[]][];
      expect(calls[0]?.[0]).toContain("UPDATE investment_transaction");
      expect(calls[0]?.[1]).toContain("confirmed");
    });

    it("edits expense row when investment_transaction not found", async () => {
      const pool = {
        query: jest
          .fn()
          .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // UPDATE investment_transaction — not found
          .mockResolvedValueOnce({ rows: [], rowCount: 1 }), // UPDATE expense
      } as never;
      const svc = new StatementsService(pool);
      await svc.reviewTransaction(3, "edit", { assetName: "Electricity", amountInr: "2500" });
      const calls = (pool as { query: jest.Mock }).query.mock.calls as [string, unknown[]][];
      expect(calls[1]?.[0]).toContain("UPDATE expense");
      expect(calls[1]?.[1]).toContain("edited");
    });

    it("is idempotent-safe: no error when row is already confirmed (rowCount 0)", async () => {
      const pool = {
        query: jest
          .fn()
          .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // UPDATE investment_transaction — not found
          .mockResolvedValueOnce({ rows: [], rowCount: 0 }), // UPDATE expense — not found
      } as never;
      const svc = new StatementsService(pool);
      // Should not throw
      await expect(svc.reviewTransaction(1, "confirm")).resolves.toBeUndefined();
    });

    it("throws HttpException if fetch throws", async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error("ECONNREFUSED"));
      const { pool } = makePool([]);
      const svc = new StatementsService(pool);
      const meta = JSON.stringify({
        type: "investment",
        platform: "zerodha",
        format: "csv",
        personId: 1,
      });
      await expect(svc.uploadStatement(makeFile(), meta)).rejects.toBeInstanceOf(HttpException);
    });
  });
});
