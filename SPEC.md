# SPEC: Phase 3b — Live Statement Ingestion Agent

## 1. Objective

Build a standalone TypeScript agent service (`agents/`) that receives uploaded financial
statements from the frontend, parses them using a combination of deterministic scripts and
Gemini AI, verifies correctness arithmetically, and returns structured transaction rows to
the NestJS backend for storage in a `needs_review` state pending human review.

**Target users:** Arjun and Priya — upload monthly statements (bank, credit card,
investment) to keep portfolio and expense data current without manual entry.

**Success looks like:** A PDF or CSV is uploaded from the UI → the agent extracts every
transaction with a confidence score and verbatim source text → the backend stores them as
`needs_review` → the user sees a review screen where they can confirm, edit, or reject
each row before it enters the confirmed ledger.

---

## 2. Acceptance Criteria

### AC-1 — Agent service is a standalone HTTP service
- Lives in `agents/` at the repo root, parallel to `backend/` and `frontend/`
- TypeScript, Express HTTP server, LangGraph functional API for graph orchestration
- Exposes `POST /parse` — accepts multipart/form-data (file + metadata JSON)
- Returns a structured JSON response: parsed transactions + verification status
- Authenticated via `INTERNAL_API_KEY` header checked in Express middleware

### AC-2 — Known platforms are supported; unknown platforms return 400
- **Investment statements:** platform and file format are known upfront (sent in metadata)
  - CSV/XLSX platforms (Zerodha, IndMoney, CoinSwitch) → deterministic column-mapped parser
  - PDF platforms (Paytm Money, Employer stock) → Gemini with platform-specific skill template
- **Expense statements:** bank account PDFs → Gemini with platform-specific skill template
- Skill registry lookup on unknown platform → immediate HTTP 400:
  `{ error: "No skill registered for platform \"X\". Supported: zerodha, indmoney, ..." }`
- No attempt to infer or generate a skill for unknown platforms

### AC-3 — Every parsed row includes a confidence score and verbatim source text
- `confidence: number` — 0.0 to 1.0; deterministic parsers always emit 1.0
- `source_text: string` — the verbatim row as it appears in the original PDF or CSV;
  Gemini extracts this in the same structured output call (no PDF parsing library needed)
- Both fields stored in the DB alongside the transaction

### AC-4 — Verifier runs after every parse attempt; retry loop on failure
- Check: `opening_balance + sum(credits) − sum(debits) ≈ closing_balance` (±₹1 tolerance)
- Investment statements without a balance signal → `verification_status = "skipped"`
- On failure: re-parse with a modified prompt containing the prior attempt + arithmetic error
- Maximum 3 attempts; on 3rd failure → return with `verification_status = "failed"`,
  do not block persist

### AC-5 — Agent returns data; backend persists
- Agent does NOT call back into the backend to write to the DB
- Agent returns `ParsedTransaction[]` + verification metadata to the backend
- Backend writes to DB with `status = 'needs_review'`
- Agent is stateless; all DB writes live in one place (the backend)

### AC-6 — Backend ingestion endpoint wired end-to-end
- `POST /ingestion/upload` — receives file from frontend, forwards to agent, persists results
- `GET /ingestion/needs-review` — returns all `needs_review` transactions for the review UI
- `PATCH /ingestion/review/:id` — confirm / edit / reject (sets `status = 'confirmed'`
  or deletes the row)

### AC-7 — DB schema updated with new columns (Migration 009)
- `investment_transaction` and `expense` tables gain three nullable columns:
  - `confidence_score NUMERIC(5,4)` — null for manually entered rows
  - `verification_status TEXT CHECK (...IN ('passed','failed','skipped'))` — null for manual
  - `raw_source JSONB` — full raw Gemini output for that row; null for manual rows
- `status` enum on both tables gains `'needs_review'`
- Existing confirmed rows are unaffected (all columns nullable)

---

## 3. Scope

### In scope
- `agents/` — full new service: server, LangGraph graph, skill registry, platform skills,
  shared parsers, verifier, prompt builder
- `backend/src/ingestion/` — new NestJS module: controller + service for upload, review, confirm
- Migration 009 — new columns + status enum additions
- `frontend/` — file upload UI (statement type + platform selector + file picker)
- Review screen — table of `needs_review` rows with confirm/edit/reject per row
- Docker Compose — add `agents` service on port 3002

### Out of scope
- Unknown / new platform handling — no skill-author, no dynamic registry (ADR-025)
- DB-backed skill registry — skills live in code only (ADR-025)
- Email forwarding or webhook-based ingestion (Phase 3c)
- Async/background job processing (can be added later without architectural change)
- New investment platforms beyond the 6 in the initial registry
- Per-transaction budget tracking or alerts
- Mobile upload flow

---

## 4. Architecture

### Call chain (sync)
```
frontend (file picker + metadata)
  → POST /ingestion/upload  (backend, NestJS)
      → POST /parse  (agents service, Express)
          → skill registry lookup  [throws → 400 if unknown platform]
          → LangGraph: parse_node → verify_node → [retry loop] → return_node
      ← { transactions[], verificationStatus, attempts }
  → INSERT to investment_transaction / expense  WHERE status = 'needs_review'
  ← { count, redirectUrl: /ingestion/review }
```

### agents/ service API

**Request:** `POST /parse` — multipart/form-data
```
file      : <binary — PDF, CSV, or XLSX>
metadata  : JSON string {
  type     : "investment" | "expense"
  platform : "zerodha" | "indmoney" | "coinswitch" | "paytm-money"
           | "employer-stock" | "hdfc-bank"
  format   : "csv" | "xlsx" | "pdf"
  personId : number
}
```

**Response (success):**
```typescript
{
  status             : "ok"
  verificationStatus : "passed" | "failed" | "skipped"
  attempts           : number           // 1–3
  transactions       : ParsedTransaction[]
  openingBalance?    : number
  closingBalance?    : number
  computedBalance?   : number
}
```

**Response (error):**
```typescript
{
  status  : "error"
  error   : string    // e.g. "No skill registered for platform \"groww\". Supported: ..."
}
```

### SkillTemplate interface
```typescript
interface SkillTemplate {
  platformId          : string
  displayName         : string
  format              : "csv" | "xlsx" | "pdf"
  parserType          : "deterministic" | "gemini"
  // deterministic only:
  columnMappings?     : Record<string, keyof ParsedTransaction>
  // Gemini only:
  systemPromptTemplate? : string   // {{RETRY_CONTEXT}} placeholder for retry attempts
  fewShotExamples?    : Array<{ sourceText: string; parsed: Partial<ParsedTransaction> }>
  balanceCheck        : "opening_closing" | "running_total" | "none"
}
```

### ParsedTransaction interface
```typescript
interface ParsedTransaction {
  date         : string    // YYYY-MM-DD
  description  : string
  amount       : number    // always positive
  type         : "debit" | "credit"
  rowType      : "expense" | "income" | "internal_transfer" | "investment"
  category?    : string    // expense rows only; from static categories config
  assetName?   : string    // investment rows only
  quantity?    : number    // investment rows only
  price?       : number    // investment rows only, native currency
  confidence   : number    // 0.0–1.0; deterministic parsers emit 1.0
  source_text  : string    // verbatim row from PDF/CSV
}
```

### LangGraph flow (Functional API)
```
invoke({ file, metadata, skill })
  │
  parse_node
  │   parserType = "deterministic" → csv.parser.ts (no LLM)
  │   parserType = "gemini"        → gemini.parser.ts (Gemini structured output)
  │                                   systemPrompt = buildSystemPrompt(skill, priorAttempt, error)
  ↓
  verify_node
  │   skill.balanceCheck = "none"  → verificationStatus = "skipped", goto return_node
  │   check passes                 → verificationStatus = "passed", goto return_node
  │   check fails, attempts < 3    → goto parse_node (with priorAttempt + error in state)
  │   check fails, attempts = 3    → verificationStatus = "failed", goto return_node
  ↓
  return_node
    → { transactions, verificationStatus, attempts, openingBalance, closingBalance }
```

### agents/ directory structure
```
agents/
├── src/
│   ├── server.ts                    # Express entry point; POST /parse handler;
│   │                                #   catches registry miss → 400
│   ├── graph.ts                     # LangGraph functional API: parse_node, verify_node,
│   │                                #   return_node, conditional edges
│   ├── prompt-builder.ts            # buildSystemPrompt(skill, prior?, error?) — pure fn
│   ├── types.ts                     # SkillTemplate, ParsedTransaction, AgentState,
│   │                                #   GraphInput, GraphOutput
│   ├── skills/
│   │   ├── registry.ts              # static Record<platformId, SkillTemplate>;
│   │   │                            #   getSkill(id) throws if not found
│   │   ├── verifier.ts              # arithmetic balance check — pure function
│   │   ├── platforms/               # one file per platform — the skill knowledge document
│   │   │   ├── zerodha.skill.ts
│   │   │   ├── indmoney.skill.ts
│   │   │   ├── coinswitch.skill.ts
│   │   │   ├── paytm-money.skill.ts
│   │   │   ├── employer-stock.skill.ts
│   │   │   └── hdfc-bank.skill.ts
│   │   └── parsers/
│   │       ├── csv.parser.ts        # shared deterministic CSV/XLSX → ParsedTransaction[]
│   │       └── gemini.parser.ts     # shared Gemini structured output call
│   └── config/
│       └── categories.ts            # static expense category list (mirrors DB)
├── package.json
├── tsconfig.json
└── .env.example
```

---

## 5. Key Design Decisions

### Skills are knowledge documents, not selectable options
Each platform skill file (`*.skill.ts`) is a structured knowledge artifact — column layout,
Gemini system prompt template, few-shot examples, balance check strategy. The skill is
loaded deterministically by registry lookup. No LLM is used to select or generate skills
at runtime. Engineering these templates carefully per platform IS the context engineering
work. See ADR-025.

### Static registry; unknown platform → 400
The skill registry is a plain `Record<platformId, SkillTemplate>` in `registry.ts`.
Adding a platform requires writing a new skill file and registering it — one code change,
one deploy. This is deliberate: skill templates require careful authoring and review;
auto-generating them at runtime is non-deterministic and hard to verify. See ADR-025.

### Gemini extracts source_text — no PDF parsing library
`source_text` is a field in the Gemini structured output schema. The prompt instructs:
*"Populate `source_text` with the exact verbatim text of that row as it appears in the
statement."* Gemini already reads the PDF visually; this costs nothing extra and avoids
PDF parsing library fragility entirely. See ADR-023.

### LangGraph Functional API — not createAgent()
`createAgent()` (LangChain v1) is designed for open-ended ReAct loops where the LLM
decides which tools to call. The parse → verify → retry sequence is predetermined;
only the parse step is LLM-driven. LangGraph Functional API gives typed state, conditional
edges, and explicit control flow without forcing LLM decision-making on a known sequence.
See ADR-022.

### Agent returns data; backend persists
The agent is a pure parsing service. It returns `ParsedTransaction[]` to the backend;
the backend owns the INSERT. No circular in-flight calls, no DB credentials in the agent,
independently testable. See ADR-024.

### buildSystemPrompt is a pure function
```typescript
// prompt-builder.ts
export function buildSystemPrompt(
  skill: SkillTemplate,
  priorAttempt: ParsedTransaction[] | null,
  error: VerificationError | null
): string {
  let prompt = skill.systemPromptTemplate ?? "";
  if (priorAttempt && error) {
    prompt += `\n\n---\nPREVIOUS ATTEMPT FAILED\n` +
              `Got total: ${error.computed}. Expected: ${error.expected}.\n` +
              `Prior output:\n${JSON.stringify(priorAttempt, null, 2)}\n` +
              `Re-examine rows and correct.`;
  }
  return prompt;
}
```

### Expense statements: tag rowType before categorising
Bank statements mix expenses, income, and internal transfers. The Gemini prompt first asks
for `rowType: "expense" | "income" | "internal_transfer" | "ignore"`, then categorises
only `expense` rows. One-shot classification + categorisation degrades accuracy.

### Categories: static config
`agents/src/config/categories.ts` mirrors the DB category list. Avoids a backend network
call before parsing begins. Updated manually when the DB list changes.

---

## 6. Tech Stack & Constraints

| Layer | Choice |
|---|---|
| Agent runtime | TypeScript + Express |
| Graph orchestration | LangGraph Functional API (`@langchain/langgraph`) |
| AI model | Gemini Flash — structured output + file upload API for PDFs |
| CSV/XLSX parsing | `csv-parse` + `xlsx` (deterministic, no AI) |
| Skill registry | Static `Record` in `registry.ts` — no DB, no dynamic loading |
| Backend | NestJS — new `IngestionModule` |
| Frontend upload | shadcn/ui `<Input type="file">` + FormData |
| DB | Existing PostgreSQL; Migration 009 adds columns |

**Constraints (from CLAUDE.md):**
- All monetary arithmetic uses `decimal.js` — never `parseFloat()` for money
- `NUMERIC(18,4)` for amounts, `NUMERIC(5,4)` for confidence scores
- All DB column names `snake_case`
- Reports always `WHERE status = 'confirmed'` — `needs_review` rows must never reach
  portfolio calculations (ADR-004)
- NestJS module pattern: `IngestionModule → IngestionController → IngestionService`
- No business logic in Next.js server actions or API routes (ADR-001)
- Agent service on port 3002 in Docker Compose

---

## 7. DB Migration (009)

```sql
-- Extend status enums (drop-and-recreate pattern per ADR on pg enum limitations)
-- Both investment_transaction.status and expense.status gain 'needs_review'

ALTER TABLE investment_transaction
  ADD COLUMN confidence_score    NUMERIC(5,4),
  ADD COLUMN verification_status TEXT
    CHECK (verification_status IN ('passed', 'failed', 'skipped')),
  ADD COLUMN raw_source          JSONB;

ALTER TABLE expense
  ADD COLUMN confidence_score    NUMERIC(5,4),
  ADD COLUMN verification_status TEXT
    CHECK (verification_status IN ('passed', 'failed', 'skipped')),
  ADD COLUMN raw_source          JSONB;
```

All columns nullable — existing confirmed rows unaffected.

---

## 8. Testing Strategy

- **Skill unit tests:** Each `*.skill.ts` is a data object — test that required fields are
  present, systemPromptTemplate includes `{{RETRY_CONTEXT}}` placeholder for Gemini skills
- **Parser unit tests:** `csv.parser.ts` and `gemini.parser.ts` tested with fixture files
  and mocked Gemini responses respectively — no HTTP, no DB
- **Verifier unit tests:** pass / fail (wrong total) / skip (balanceCheck = "none") cases
- **prompt-builder unit tests:** assert retry context is appended on second attempt,
  absent on first
- **Graph integration test:** mock parse_node output; feed a verifier-failing response;
  assert retry fires and `verificationStatus = "failed"` after 3 attempts
- **registry unit test:** assert `getSkill("unknown")` throws with the supported-list message
- **Backend ingestion integration test:** POST fixture file → assert DB rows with
  `status = 'needs_review'` and correct column values
- **Manual E2E:** Upload real Zerodha CSV + real Paytm Money PDF; verify review screen

---

## 9. Boundaries

| Rule | Reason |
|---|---|
| Never use `parseFloat()` for monetary amounts | `decimal.js` only — ADR-005 |
| Never let `needs_review` rows reach portfolio calculations | ADR-004 confirmed-only filter |
| Never modify existing ADRs | Supersede with new numbered ADR |
| Never write business logic in Next.js server actions | ADR-001 |
| Never call the backend from the agent to persist | Agent is a pure parser — ADR-024 |
| Never attempt to infer a skill for an unknown platform | Throw 400 immediately — ADR-025 |
| Never generate skill templates at runtime | Skills are authored once, reviewed, committed |
| Always cap re-parse retries at 3 | Prevent infinite loops on intractable statements |
| Always include `source_text` in Gemini structured output schema | HITL review UX — ADR-023 |
| Always pass platform + format from the UI | Agent must not guess — metadata is the contract |

---

## 10. ADRs — written alongside this spec

| ADR | Decision |
|---|---|
| ADR-021 | Agent service as a separate process — not embedded in NestJS |
| ADR-022 | LangGraph Functional API — not `createAgent()` or plain chains |
| ADR-023 | Gemini `source_text` extraction — no PDF parsing library |
| ADR-024 | Agent-returns-data pattern — backend owns all DB writes |
| ADR-025 | Static code-based skill registry — known platforms only, no dynamic registration |
