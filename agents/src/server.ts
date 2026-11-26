import { timingSafeEqual } from "node:crypto";
import express from "express";
import multer from "multer";
import { runGraph } from "./agents/statements-parser/graph";
import type { RequestMetadata } from "./agents/statements-parser/types";

const app = express();
const PORT = process.env.PORT ?? 3002;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

// ── Auth middleware ───────────────────────────────────────────────────────────

// Constant-time comparison so the shared secret can't be recovered via response timing.
function isValidApiKey(provided: unknown): boolean {
  const expected = process.env.INTERNAL_API_KEY;
  if (!expected || typeof provided !== "string") return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

app.use((req, res, next) => {
  if (req.path === "/health") return next();
  if (!isValidApiKey(req.headers["x-internal-api-key"])) {
    res.status(401).json({ status: "error", error: "Unauthorized" });
    return;
  }
  next();
});

// ── Routes ────────────────────────────────────────────────────────────────────

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.post("/parse", upload.single("file"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ status: "error", error: "No file uploaded" });
    return;
  }

  let metadata: RequestMetadata;
  try {
    const rawBody = req.body as { metadata?: string };
    metadata = JSON.parse(rawBody.metadata ?? "") as RequestMetadata;
  } catch {
    res.status(400).json({ status: "error", error: "Invalid or missing metadata JSON" });
    return;
  }

  const output = await runGraph({ file: req.file.buffer, metadata });

  if (output.status === "error") {
    res.status(400).json(output);
    return;
  }

  res.json(output);
});

// ── Start ─────────────────────────────────────────────────────────────────────

if (require.main === module) {
  if (!process.env.INTERNAL_API_KEY || process.env.INTERNAL_API_KEY === "changeme") {
    console.warn("[agents] INTERNAL_API_KEY is unset or the default — set a random value in .env");
  }
  app.listen(PORT, () => {
    console.log(`agents service running on port ${PORT}`);
  });
}

export { app };
