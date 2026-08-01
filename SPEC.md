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

---

# EXTENSION: Expense Statement Ingestion — Credit Card, Transfer Classification, Auto-Approval

**Status:** Spec drafted 2026-08-01. Extends Phase 3b above; no changes to the core
agent architecture (ADR-021–025 all still apply unchanged).

## 11. Objective

Ingest HDFC Credit Card statements alongside the existing HDFC/ICICI bank statement
skills, classify every row into a spend category, and — critically — recognize the
two ways money moves without being a real expense:

1. **Credit card bill payment** — appears on the *bank* statement as a lump-sum debit
   to the credit card. The underlying purchases are already itemized on the *credit
   card* statement. Counting both double-counts the spend.
2. **Household transfer** — Arjun ↔ Priya move money between themselves (rent
   split, reimbursement, shared groceries). Not spend by the household; it's an
   internal wash.

A third existing case — SIP/investment debits from a bank account — is already
correctly excluded (`rowType: "investment"` rows are filtered before insert) but
gets the same explicit treatment here for prompt consistency.

**Target users:** Arjun (primary HDFC cardholder, sole HDFC bank account) and
Priya (add-on HDFC cardholder, own HDFC bank account, two ICICI bank accounts).

**Key wrinkle driving the design:** the HDFC Credit Card statement is a single PDF
covering **both** Arjun's primary card and Priya's add-on card on the same
account. Person attribution therefore cannot be "whoever selected themselves in the
upload picker" — it must be resolved **per transaction** from the cardholder name
printed in the statement.

**Success looks like:** Uploading a monthly HDFC CC statement splits transactions
between Arjun and Priya correctly; uploading the following month's HDFC bank
statement recognizes the CC bill payment line and stores it as a tagged transfer,
not a second expense; the review queue shows only the handful of rows the model
wasn't confident about — everything else is auto-approved.

## 12. Acceptance Criteria

### AC-E1 — HDFC Credit Card skill
- New platform `hdfc-credit-card` registered in `skills/registry.ts`, format `pdf`,
  `parserType: "gemini"`, `balanceCheck: "opening_closing"` (previous balance +
  purchases − payments/credits ≈ new balance, ±₹1 tolerance — same check style as
  `hdfc-bank`)
- Every transaction is attributed to a cardholder. The skill prompt instructs Gemini
  to read the cardholder name printed against each transaction/section (HDFC CC
  statements group transactions under "Domestic Transactions — <Name>" headers or
  print the cardholder name per line) and populate `cardHolderName` verbatim
- Categorised into the same static category list as bank statements

### AC-E2 — Per-row person resolution
- `ParsedTransaction` gains an optional `cardHolderName?: string` field
- Backend resolves `cardHolderName` → `person_id` via case-insensitive first-name
  match against the `person` table (`Arjun`, `Priya`)
- If `cardHolderName` is absent or matches no known person, fall back to
  `metadata.personId` (the person selected in the upload UI) — never drop the row
  or throw
- Applies to any platform that can mix cardholders in one file (initially just
  `hdfc-credit-card`); bank statements continue to use `metadata.personId` directly
  since one bank statement PDF = one account = one person

### AC-E3 — Transfers are stored and tagged, never dropped
- `ParsedTransaction` gains an optional `transferType?: "investment_platform" |
  "household_member" | "own_account"`, required whenever `rowType ===
  "internal_transfer"`
- On insert, `internal_transfer` rows are no longer filtered out. They are written
  to `expense` with `category_id` = the `"Transfer"` category and
  `transfer_type` set to the classified value
- Reports that compute "total spend" must filter `WHERE transfer_type IS NULL`
  (documented here for whoever builds the expenses report page next — no such page
  exists yet, so no query changes needed in this feature)
- `rowType: "investment"` and `rowType: "income"` rows remain filtered out
  entirely (unchanged from current behavior) — out of scope for this feature;
  investment debits are already captured via the investment ingestion pipeline
- `rowType: "ignore"` rows (bank fees, tax lines) remain dropped

### AC-E4 — Real per-row confidence, not a hardcoded constant
- Remove the literal `confidence: 0.85` instruction from `hdfc-bank.skill.ts` and
  `icici-bank.skill.ts` — replace with a calibration rubric in the prompt:
  - **0.95–1.0** — well-known merchant/pattern, unambiguous category and rowType
  - **0.70–0.94** — recognizable but with some ambiguity (generic UPI narration,
    category inferred rather than stated, uncertain cardholder attribution)
  - **< 0.70** — garbled/truncated text, unfamiliar merchant, ambiguous rowType,
    category, or transferType
- Include at least one high-confidence and one low-confidence few-shot example per
  skill so the model has calibration anchors, not just a format example

### AC-E5 — Confidence-based auto-approval for expense rows
- Threshold: **0.85** (matches the existing "low confidence" cutoff already used in
  the investment review UI)
- A row is inserted with `status = 'confirmed'` directly (skipping manual review)
  iff `confidence >= 0.85` **and** the statement-level `verificationStatus !==
  'failed'`. If the whole statement failed its balance check, every row from it
  goes to `'pending'` regardless of individual confidence — something is off with
  the parse as a whole
- Otherwise inserted with `status = 'pending'` as today
- Applies uniformly to expense and transfer rows alike — a misclassified transfer
  that's actually real spend is a worse error than an unnecessary review click, so
  transfers don't get a free pass on the confidence gate
- This is a deliberate divergence from the investment flow, where every row still
  requires a manual Confirm click regardless of confidence — investment statements
  are low-volume (tens of rows/month); expense statements are high-volume (often
  100+ rows/month) and the user has explicitly asked not to hand-review all of them

### AC-E6 — Frontend surfaces the auto-approval split
- `hdfc-credit-card` added to `EXPENSE_PLATFORMS` in `StatementUploader.tsx`
- Upload summary shows the breakdown, not just "+N new": auto-approved count,
  needs-review count, skipped (dedup) count
- Pending review table gains a **Person** column — necessary now that a single CC
  upload can contain rows belonging to either Arjun or Priya, so the reviewer
  can catch a misattributed cardholder before confirming
- Pending review table's Platform column shows the real institution/product label
  (e.g. "HDFC Credit Card") instead of the current hardcoded literal `"expense"`
  string
- `CATEGORY_BADGE` gains entries for the 14 expense categories, same visual
  language as the existing investment category badges

## 13. Scope

### In scope
- `agents/src/agents/statements-parser/skills/platforms/hdfc-credit-card.skill.ts`
  — new skill file
- Rewritten prompts (confidence rubric + transfer few-shot examples) for
  `hdfc-bank.skill.ts` and `icici-bank.skill.ts`
- `types.ts` — add `cardHolderName?`, `transferType?` to `ParsedTransaction`
- `gemini.parser.ts` — extend `RESPONSE_SCHEMA` with the two new fields
- `skills/registry.ts` — register `hdfc-credit-card`
- `backend/src/statements/statements.service.ts`:
  - person resolution by cardholder name (with fallback)
  - transfer-row insert path (category = Transfer, transfer_type set)
  - auto-approval branch (confidence + verification gate)
  - `raw_source` gains the resolved platform/institution label for display
  - `PendingRow` gains `personName`
- `frontend/src/app/(app)/statements/StatementUploader.tsx` — CC platform option,
  summary breakdown, Person column, Platform column fix, expense category badges
- `frontend/src/types/index.ts` — extend `UploadResponse`/`PendingTransaction` to
  match
- New ADR-026 documenting the transfer/auto-approval/person-attribution decisions

### Out of scope
- ICICI Credit Card or any other card issuer (HDFC only, per user)
- Income row ingestion (still dropped, unchanged)
- A dedicated expenses reporting/dashboard page — doesn't exist yet; the
  `transfer_type IS NULL` filter is documented for whenever that page is built
- "Holdings rebuild on confirm" — carried over from last session's TODO, untouched
  here
- Any new DB migration — `expense.transfer_type` and `expense.person_id` already
  exist (migrations 001, 002); this feature only starts populating them correctly

## 14. Key Design Decisions

### Per-row person attribution, not per-upload
An add-on card statement is one file with two cardholders. Forcing a per-upload
person selector would require the user to manually split a single PDF or upload it
twice and somehow suppress half the rows each time — not practical. Gemini already
reads the cardholder name per transaction section; extracting it costs nothing
extra, same rationale as `source_text` in ADR-023.

### Store transfers, don't drop them
The `expense.transfer_type` enum (`investment_platform` / `household_member` /
`own_account`) was added in migration 002 specifically for this purpose and has
been unused. Dropping `internal_transfer` rows (today's behavior) silently
discards the money trail — the user can't see "I paid ₹X to my CC bill this
month" anywhere. Storing them with the tag preserves reconciliation ability while
keeping them out of expense totals via a `WHERE transfer_type IS NULL` filter.

### Auto-approval only on both row confidence AND statement verification
Gating on row confidence alone would auto-approve every row from a statement whose
arithmetic doesn't reconcile, just because each row individually looked clean to
Gemini — a false sense of safety. Requiring `verificationStatus !== 'failed'` at
the statement level too means a bad parse forces full manual review even if
individual rows look confident.

### No schema changes required
Both `transfer_type` and `person_id` already exist on `expense`. This feature is
entirely prompt engineering + backend logic + frontend display — a deliberately
narrow blast radius.

## 15. Testing Strategy

- `hdfc-credit-card.skill.ts` unit test: required fields present, prompt template
  contains `{{RETRY_CONTEXT}}`, cardholder-attribution instruction present
- `gemini.parser.ts` schema test: `cardHolderName`/`transferType` accepted,
  `transferType` not required for non-transfer rows
- `statements.service.spec.ts` new cases:
  - confidence ≥ 0.85 + verification passed → `status = 'confirmed'`
  - confidence < 0.85 → `status = 'pending'`
  - verification `'failed'` at statement level → all rows `'pending'` regardless
    of individual confidence
  - `internal_transfer` row → inserted with `category = 'Transfer'`,
    `transfer_type` set, not silently dropped
  - `cardHolderName: "PRIYA MEHTA"` resolves to Priya's `person_id`
    regardless of `metadata.personId` sent by the uploader
  - missing/unrecognized `cardHolderName` falls back to `metadata.personId`
- Manual E2E: upload a real HDFC CC statement, verify the Arjun/Priya split;
  upload the following bank statement, verify the CC payment line lands as a
  tagged transfer and the review queue only shows genuinely low-confidence rows

## 16. Boundaries

| Rule | Reason |
|---|---|
| Never let auto-approval fire when statement `verificationStatus = 'failed'` | A failed balance check means something in the whole parse is untrustworthy |
| Never hardcode a confidence value in a skill prompt | Defeats the auto-approval signal entirely — must reflect real per-row certainty |
| Never fabricate real account numbers/UPI IDs in few-shot examples | Skill files are committed to git; use placeholder patterns only |
| Always fall back to `metadata.personId` when cardholder name doesn't resolve | Never drop a row or throw for missing attribution |
| Never count `transfer_type IS NOT NULL` rows in expense-total reports (future) | ADR-004-style discipline — silent double-counting is a correctness bug |
| `rowType: "investment"` and `"income"` rows stay filtered out (unchanged) | Out of scope; investment debits are already captured elsewhere |

## 17. ADRs — to be written alongside implementation

| ADR | Decision |
|---|---|
| ADR-026 | Expense transfer classification (populate `transfer_type`), confidence-gated auto-approval, and per-row cardholder→person attribution for shared credit card statements |
