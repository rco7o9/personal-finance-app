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

  describe("expense auto-approval and transfer handling", () => {
    function expenseMeta(overrides: Partial<Record<string, unknown>> = {}) {
      return JSON.stringify({
        type: "expense",
        platform: "hdfc-bank",
        format: "pdf",
        personId: 1,
        ...overrides,
      });
    }

    it("auto-confirms a row with confidence >= 0.85 when verification passed, and omits it from transactions", async () => {
      mockFetch(
        agentOkResponse({
          verificationStatus: "passed",
          transactions: [
            {
              rowType: "expense",
              date: "2026-01-01",
              description: "SWIGGY",
              amount: 500,
              type: "debit",
              category: "Food & Dining",
              confidence: 0.95,
              source_text: "SWIGGY 500",
            },
          ],
        }),
      );

      const { pool, client } = makePool([
        { rows: [{ id: 1 }], rowCount: 1 }, // currency
        { rows: [], rowCount: 0 }, // dedup
        { rows: [], rowCount: 0 }, // BEGIN
        { rows: [{ id: 5 }], rowCount: 1 }, // category found
        { rows: [{ id: 100 }], rowCount: 1 }, // INSERT expense
        { rows: [], rowCount: 0 }, // COMMIT
      ]);
      const svc = new StatementsService(pool);
      const result = await svc.uploadStatement(makeFile(), expenseMeta());

      expect(result.inserted).toBe(1);
      expect(result.autoApproved).toBe(1);
      expect(result.needsReview).toBe(0);
      expect(result.transactions).toEqual([]);

      const insertCall = client.query.mock.calls[4] as [string, unknown[]];
      expect(insertCall[0]).toContain("INSERT INTO expense");
      expect(insertCall[1][6]).toBe("confirmed"); // status
    });

    it("leaves a row pending when confidence < 0.85", async () => {
      mockFetch(
        agentOkResponse({
          verificationStatus: "passed",
          transactions: [
            {
              rowType: "expense",
              date: "2026-01-02",
              description: "UNKNOWN MERCHANT",
              amount: 240,
              type: "debit",
              category: "Other",
              confidence: 0.5,
              source_text: "UNKNOWN MERCHANT 240",
            },
          ],
        }),
      );

      const pendingRow = {
        id: 101,
        date: "2026-01-02",
        assetName: "UNKNOWN MERCHANT",
        platform: "HDFC Bank",
        categoryName: "Other",
        quantity: null,
        price: null,
        nativeCurrency: "INR",
        amountInr: "240.0000",
        status: "pending",
        confidenceScore: "0.5000",
        verificationStatus: "passed",
      };
      const { pool } = makePool([
        { rows: [{ id: 1 }], rowCount: 1 }, // currency
        { rows: [], rowCount: 0 }, // dedup
        { rows: [], rowCount: 0 }, // BEGIN
        { rows: [{ id: 5 }], rowCount: 1 }, // category found
        { rows: [{ id: 101 }], rowCount: 1 }, // INSERT expense
        { rows: [], rowCount: 0 }, // COMMIT
        { rows: [pendingRow], rowCount: 1 }, // fetchPendingExpenseRows
      ]);
      const svc = new StatementsService(pool);
      const result = await svc.uploadStatement(makeFile(), expenseMeta());

      expect(result.autoApproved).toBe(0);
      expect(result.needsReview).toBe(1);
      expect(result.transactions).toHaveLength(1);
    });

    it("keeps every row pending when the statement-level verification failed, regardless of confidence", async () => {
      mockFetch(
        agentOkResponse({
          verificationStatus: "failed",
          transactions: [
            {
              rowType: "expense",
              date: "2026-01-03",
              description: "SWIGGY",
              amount: 500,
              type: "debit",
              category: "Food & Dining",
              confidence: 0.99,
              source_text: "SWIGGY 500",
            },
          ],
        }),
      );

      const { pool, client } = makePool([
        { rows: [{ id: 1 }], rowCount: 1 }, // currency
        { rows: [], rowCount: 0 }, // dedup
        { rows: [], rowCount: 0 }, // BEGIN
        { rows: [{ id: 5 }], rowCount: 1 }, // category found
        { rows: [{ id: 102 }], rowCount: 1 }, // INSERT expense
        { rows: [], rowCount: 0 }, // COMMIT
        { rows: [], rowCount: 0 }, // fetchPendingExpenseRows
      ]);
      const svc = new StatementsService(pool);
      const result = await svc.uploadStatement(makeFile(), expenseMeta());

      expect(result.autoApproved).toBe(0);
      expect(result.needsReview).toBe(1);
      const insertCall = client.query.mock.calls[4] as [string, unknown[]];
      expect(insertCall[1][6]).toBe("pending"); // status
    });

    it("stores an internal_transfer row under the Transfer category with transfer_type set, instead of dropping it", async () => {
      mockFetch(
        agentOkResponse({
          verificationStatus: "passed",
          transactions: [
            {
              rowType: "internal_transfer",
              date: "2026-01-04",
              description: "HDFC CREDIT CARD PAYMENT-AUTOPAY",
              amount: 45000,
              type: "debit",
              transferType: "own_account",
              confidence: 0.97,
              source_text: "HDFC CREDIT CARD PAYMENT-AUTOPAY 45000",
            },
          ],
        }),
      );

      const { pool, client } = makePool([
        { rows: [{ id: 1 }], rowCount: 1 }, // currency
        { rows: [], rowCount: 0 }, // dedup
        { rows: [], rowCount: 0 }, // BEGIN
        { rows: [], rowCount: 0 }, // category SELECT "Transfer" — not found
        { rows: [{ id: 20 }], rowCount: 1 }, // category INSERT "Transfer"
        { rows: [{ id: 103 }], rowCount: 1 }, // INSERT expense
        { rows: [], rowCount: 0 }, // COMMIT
      ]);
      const svc = new StatementsService(pool);
      const result = await svc.uploadStatement(makeFile(), expenseMeta());

      expect(result.inserted).toBe(1);
      expect(result.autoApproved).toBe(1);

      const calls = client.query.mock.calls as [string, unknown[]][];
      const catSelectCall = calls[3];
      expect(catSelectCall[0]).toContain("expense_category");
      expect(catSelectCall[1]).toEqual(["Transfer"]);

      const insertCall = calls[5];
      expect(insertCall[0]).toContain("INSERT INTO expense");
      expect(insertCall[1][7]).toBe("own_account"); // transfer_type
    });
  });

  describe("per-cardholder person resolution", () => {
    function ccMeta() {
      return JSON.stringify({
        type: "expense",
        platform: "hdfc-credit-card",
        format: "pdf",
        personId: 1, // uploader selected Arjun
      });
    }

    it("resolves cardHolderName to the matching person_id, independent of metadata.personId", async () => {
      mockFetch(
        agentOkResponse({
          verificationStatus: "passed",
          transactions: [
            {
              rowType: "expense",
              date: "2026-01-05",
              description: "ZARA INDIA",
              amount: 4850,
              type: "debit",
              category: "Shopping",
              cardHolderName: "PRIYA MEHTA",
              confidence: 0.96,
              source_text: "ZARA INDIA PRIYA MEHTA 4850",
            },
          ],
        }),
      );

      const { pool, client } = makePool([
        { rows: [{ id: 1 }], rowCount: 1 }, // currency
        { rows: [], rowCount: 0 }, // dedup
        { rows: [], rowCount: 0 }, // BEGIN
        { rows: [{ id: 2 }], rowCount: 1 }, // resolvePersonId → Priya
        { rows: [{ id: 5 }], rowCount: 1 }, // category found
        { rows: [{ id: 200 }], rowCount: 1 }, // INSERT expense
        { rows: [], rowCount: 0 }, // COMMIT
      ]);
      const svc = new StatementsService(pool);
      await svc.uploadStatement(makeFile(), ccMeta());

      const insertCall = client.query.mock.calls[5] as [string, unknown[]];
      expect(insertCall[0]).toContain("INSERT INTO expense");
      expect(insertCall[1][0]).toBe(2); // person_id resolved to Priya, not the uploader (1)
    });

    it("falls back to metadata.personId when cardHolderName matches nobody", async () => {
      mockFetch(
        agentOkResponse({
          verificationStatus: "passed",
          transactions: [
            {
              rowType: "expense",
              date: "2026-01-06",
              description: "POS 449182",
              amount: 650,
              type: "debit",
              category: "Other",
              cardHolderName: "UNKNOWN CARDHOLDER",
              confidence: 0.9,
              source_text: "POS 449182 UNKNOWN CARDHOLDER 650",
            },
          ],
        }),
      );

      const { pool, client } = makePool([
        { rows: [{ id: 1 }], rowCount: 1 }, // currency
        { rows: [], rowCount: 0 }, // dedup
        { rows: [], rowCount: 0 }, // BEGIN
        { rows: [], rowCount: 0 }, // resolvePersonId → no match
        { rows: [{ id: 5 }], rowCount: 1 }, // category found
        { rows: [{ id: 201 }], rowCount: 1 }, // INSERT expense
        { rows: [], rowCount: 0 }, // COMMIT
      ]);
      const svc = new StatementsService(pool);
      await svc.uploadStatement(makeFile(), ccMeta());

      const insertCall = client.query.mock.calls[5] as [string, unknown[]];
      expect(insertCall[1][0]).toBe(1); // falls back to uploader's personId
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
