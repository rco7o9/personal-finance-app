import fs from "node:fs";
import path from "node:path";

// Household-specific facts (member names, named payees, employer) live in a JSON file
// outside the source tree so the repository stays free of personal data:
//   agents/household.config.json          — your real household (gitignored)
//   agents/household.config.example.json  — fictional sample, committed
// HOUSEHOLD_CONFIG_PATH overrides the location. Tests always use the example file so
// they are deterministic regardless of what is configured locally.

export interface HouseholdMember {
  // Matches person.name in the database (person attribution uses ILIKE on this).
  name: string;
  // Name as printed on statements, e.g. "ARJUN MEHTA".
  statementName: string;
  cardRole?: "primary" | "add-on";
}

export interface PayeeRule {
  payees: string[];
  category: string;
  note?: string;
}

export interface HouseholdConfig {
  members: HouseholdMember[];
  payeeRules: PayeeRule[];
  employerStock: {
    displayName: string;
    assetName: string;
  };
}

const AGENTS_ROOT = path.resolve(__dirname, "../../../..");
const EXAMPLE_PATH = path.join(AGENTS_ROOT, "household.config.example.json");
const LOCAL_PATH = path.join(AGENTS_ROOT, "household.config.json");

function resolveConfigPath(): string {
  if (process.env.NODE_ENV === "test") return EXAMPLE_PATH;
  if (process.env.HOUSEHOLD_CONFIG_PATH) return process.env.HOUSEHOLD_CONFIG_PATH;
  return fs.existsSync(LOCAL_PATH) ? LOCAL_PATH : EXAMPLE_PATH;
}

function loadHouseholdConfig(): HouseholdConfig {
  const configPath = resolveConfigPath();
  const parsed = JSON.parse(fs.readFileSync(configPath, "utf8")) as HouseholdConfig;
  if (!Array.isArray(parsed.members) || parsed.members.length === 0) {
    throw new Error(`Household config at ${configPath} must list at least one member`);
  }
  if (configPath === EXAMPLE_PATH && process.env.NODE_ENV !== "test") {
    console.warn(
      "[household] Using household.config.example.json — copy it to household.config.json " +
        "and fill in your own household for accurate categorization.",
    );
  }
  return { ...parsed, payeeRules: parsed.payeeRules ?? [] };
}

export const HOUSEHOLD: HouseholdConfig = loadHouseholdConfig();

// ── Helpers for prompts and few-shot examples ─────────────────────────────────

const BASE_PAYEE_CATEGORIES = new Set(["Rent", "Maintenance"]);

export const PRIMARY_MEMBER: HouseholdMember = HOUSEHOLD.members[0];
export const SECONDARY_MEMBER: HouseholdMember = HOUSEHOLD.members[1] ?? HOUSEHOLD.members[0];

// "Arjun and Priya" / "Arjun, Priya and Kabir"
export const MEMBER_NAMES_SENTENCE: string = HOUSEHOLD.members
  .map((m) => m.name)
  .join(", ")
  .replace(/, ([^,]*)$/, " and $1");

// Payee rules for relatives outside the household (e.g. parents) — used to build
// few-shot examples showing these transfers are expenses, not internal transfers.
export const FAMILY_PAYEE_RULES: PayeeRule[] = HOUSEHOLD.payeeRules.filter(
  (r) => !BASE_PAYEE_CATEGORIES.has(r.category) && r.payees.length > 0,
);
