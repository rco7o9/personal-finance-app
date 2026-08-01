"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Upload, FileText, Check, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { apiPostForm, apiPatch } from "@/lib/api";
import { CATEGORY_BADGE, DEFAULT_BADGE } from "@/lib/categoryBadges";
import type { PendingTransaction, UploadResponse } from "@/types";

const INVESTMENT_PLATFORMS = [
  { value: "zerodha", label: "Zerodha" },
  { value: "indmoney", label: "INDMoney" },
  { value: "coinswitch", label: "CoinSwitch" },
  { value: "paytm-money", label: "PayTM Money" },
  { value: "employer-stock", label: "Employer stock" },
];

const EXPENSE_PLATFORMS = [
  { value: "hdfc-bank", label: "HDFC Bank" },
  { value: "icici-bank", label: "ICICI Bank" },
  { value: "hdfc-credit-card", label: "HDFC Credit Card" },
];

function formatTableDate(dateStr: string): string {
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" }).format(
    new Date(dateStr),
  );
}

function formatQuantity(qty: string | null): string {
  if (!qty) return "—";
  const n = parseFloat(qty);
  if (n === 0) return "—";
  if (n % 1 === 0) return n.toLocaleString("en-IN");
  return parseFloat(n.toPrecision(4)).toString();
}

function formatPrice(price: string | null, currency: string | null): string {
  if (!price) return "—";
  const n = parseFloat(price);
  if (n === 0) return "—";
  if (currency === "USD")
    return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(1)}L`;
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function formatAmount(amount: string): string {
  const n = parseFloat(amount);
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

interface LocalRow extends PendingTransaction {
  localStatus: "pending" | "editing" | "confirmed" | "rejected";
  editAssetName: string;
  editAmountInr: string;
}

function toLocalRow(t: PendingTransaction): LocalRow {
  return {
    ...t,
    localStatus: "pending",
    editAssetName: t.assetName,
    editAmountInr: t.amountInr,
  };
}

interface UploadSummary {
  filename: string;
  inserted: number;
  autoApproved: number;
  needsReview: number;
  skipped: number;
}

interface Props {
  personId: number | null;
  initialPendingRows: PendingTransaction[];
}

export function StatementUploader({ personId, initialPendingRows }: Props) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isDragging, setIsDragging] = useState(false);
  const [statementType, setStatementType] = useState<"investment" | "expense">("investment");
  const [platform, setPlatform] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [uploadSummary, setUploadSummary] = useState<UploadSummary | null>(null);
  const [rows, setRows] = useState<LocalRow[]>(() => initialPendingRows.map(toLocalRow));

  const platforms = statementType === "investment" ? INVESTMENT_PLATFORMS : EXPENSE_PLATFORMS;
  const visibleRows = rows.filter(
    (r) => r.localStatus !== "rejected" && r.localStatus !== "confirmed",
  );
  const confirmedCount = rows.filter((r) => r.localStatus === "confirmed").length;
  const totalForProgress = rows.filter((r) => r.localStatus !== "rejected").length;

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => setIsDragging(false), []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) setSelectedFile(file);
  }, []);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSelectedFile(e.target.files?.[0] ?? null);
  }, []);

  function clearFile() {
    setSelectedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleUpload() {
    if (!selectedFile) return;
    if (!platform) {
      setErrorMsg("Please select a platform before uploading.");
      return;
    }
    setUploading(true);
    setErrorMsg("");
    try {
      const ext = selectedFile.name.split(".").pop()?.toLowerCase() ?? "";
      const format = ext === "pdf" ? "pdf" : ext === "xlsx" || ext === "xls" ? "xlsx" : "csv";
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append(
        "metadata",
        JSON.stringify({ type: statementType, platform, format, personId: personId ?? 1 }),
      );
      const result = await apiPostForm<UploadResponse>("/statements/upload", formData);

      setUploadSummary({
        filename: selectedFile.name,
        inserted: result.inserted,
        autoApproved: result.autoApproved,
        needsReview: result.needsReview,
        skipped: result.skipped,
      });

      setRows((prev) => {
        const existingIds = new Set(prev.map((r) => r.id));
        const newLocal = result.transactions.filter((t) => !existingIds.has(t.id)).map(toLocalRow);
        return [...newLocal, ...prev];
      });

      clearFile();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function handleConfirm(id: number) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, localStatus: "confirmed" } : r)));
    try {
      await apiPatch(`/statements/${id}`, { action: "confirm" });
    } catch {
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, localStatus: "pending" } : r)));
    }
  }

  async function handleSaveEdit(id: number, assetName: string, amountInr: string) {
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, assetName, amountInr, localStatus: "confirmed" } : r)),
    );
    try {
      await apiPatch(`/statements/${id}`, { action: "edit", assetName, amountInr });
    } catch {
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, localStatus: "editing" } : r)));
    }
  }

  async function handleReject(id: number) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, localStatus: "rejected" } : r)));
    try {
      await apiPatch(`/statements/${id}`, { action: "reject" });
    } catch {
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, localStatus: "pending" } : r)));
    }
  }

  function startEdit(id: number) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, localStatus: "editing" } : r)));
  }

  function handleCommit() {
    router.push(`/portfolio${personId ? `?personId=${personId}` : ""}`);
  }

  return (
    <div className="space-y-4">
      {/* Upload card */}
      <div className="rounded-xl border p-6">
        {/* Type toggle + platform selector */}
        <div className="mb-5 flex items-center gap-3">
          <div className="flex rounded-lg border p-0.5">
            {(["investment", "expense"] as const).map((t) => (
              <button
                key={t}
                onClick={() => {
                  setStatementType(t);
                  setPlatform("");
                }}
                className={cn(
                  "rounded-md px-3 py-1 text-sm font-medium capitalize transition-colors",
                  statementType === t
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t}
              </button>
            ))}
          </div>
          <select
            value={platform}
            onChange={(e) => setPlatform(e.target.value)}
            className="border-input bg-background text-foreground focus:ring-ring/50 rounded-lg border px-2.5 py-1.5 text-sm outline-none focus:ring-2"
          >
            <option value="">Select platform</option>
            {platforms.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        {/* Drop zone */}
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={cn(
            "rounded-lg border-2 border-dashed p-10 text-center transition-colors",
            isDragging
              ? "border-primary bg-primary/5"
              : selectedFile
                ? "border-border bg-muted/20"
                : "border-border hover:border-muted-foreground/50",
          )}
        >
          {selectedFile ? (
            <div className="flex flex-col items-center gap-2">
              <FileText className="text-muted-foreground h-8 w-8" />
              <p className="text-sm font-medium">{selectedFile.name}</p>
              <p className="text-muted-foreground text-xs">
                {(selectedFile.size / 1024).toFixed(0)} KB
              </p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3">
              <Upload className="text-muted-foreground h-8 w-8" />
              <div>
                <p className="text-sm font-medium">Drop monthly {statementType} statement here</p>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  {statementType === "investment"
                    ? "INDMoney · Zerodha · PayTM Money · CoinSwitch"
                    : "HDFC Bank · ICICI Bank · HDFC Credit Card statement (PDF)"}
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                Browse files
              </Button>
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept=".pdf,.csv,.xlsx,.xls"
            onChange={handleFileChange}
          />
        </div>

        {selectedFile && (
          <div className="mt-3 flex items-center justify-between">
            <button
              onClick={clearFile}
              className="text-muted-foreground hover:text-foreground text-xs"
            >
              Remove file
            </button>
            <Button onClick={() => void handleUpload()} disabled={uploading}>
              {uploading ? "Parsing…" : "Upload & Parse"}
            </Button>
          </div>
        )}

        {errorMsg && <p className="mt-3 text-sm text-red-500">{errorMsg}</p>}

        {uploadSummary && !selectedFile && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <FileText className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
            <span className="text-muted-foreground font-medium">{uploadSummary.filename}</span>
            <span className="text-muted-foreground">·</span>
            <span className="font-medium text-green-400">+{uploadSummary.inserted} new</span>
            {uploadSummary.autoApproved > 0 && (
              <span className="text-muted-foreground">
                {uploadSummary.autoApproved} auto-approved
              </span>
            )}
            {uploadSummary.needsReview > 0 && (
              <span className="font-medium text-amber-400">
                {uploadSummary.needsReview} need review
              </span>
            )}
            {uploadSummary.skipped > 0 && (
              <span className="text-muted-foreground">{uploadSummary.skipped} skipped</span>
            )}
          </div>
        )}
      </div>

      {/* Pending review panel */}
      {visibleRows.length > 0 && (
        <div className="rounded-xl border">
          <div className="flex items-center justify-between border-b px-6 py-4">
            <h3 className="text-sm font-semibold">Pending Review</h3>
            <div className="flex items-center gap-3">
              <span className="text-muted-foreground text-xs">
                {confirmedCount} of {totalForProgress} confirmed
              </span>
              <div className="bg-muted h-1.5 w-24 overflow-hidden rounded-full">
                <div
                  className="h-full rounded-full bg-green-500 transition-all duration-300"
                  style={{
                    width: `${totalForProgress ? (confirmedCount / totalForProgress) * 100 : 0}%`,
                  }}
                />
              </div>
            </div>
          </div>

          <div className="px-6 pt-2 pb-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground border-b text-xs">
                  <th className="pb-2 text-left font-medium">Date</th>
                  <th className="pb-2 text-left font-medium">Asset</th>
                  <th className="pb-2 text-left font-medium">Platform</th>
                  <th className="pb-2 text-left font-medium">Person</th>
                  <th className="pb-2 text-left font-medium">Type</th>
                  <th className="pb-2 text-right font-medium">Units</th>
                  <th className="pb-2 text-right font-medium">Price</th>
                  <th className="pb-2 text-right font-medium">Amount</th>
                  <th className="pb-2 text-right font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {visibleRows.map((row) => (
                  <ReviewRow
                    key={row.id}
                    row={row}
                    onConfirm={() => void handleConfirm(row.id)}
                    onReject={() => void handleReject(row.id)}
                    onEdit={() => startEdit(row.id)}
                    onSaveEdit={(name, amt) => void handleSaveEdit(row.id, name, amt)}
                  />
                ))}
              </tbody>
            </table>

            <div className="mt-4 flex justify-end">
              <Button size="sm" onClick={handleCommit}>
                Done — go to Portfolio
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface ReviewRowProps {
  row: LocalRow;
  onConfirm: () => void;
  onReject: () => void;
  onEdit: () => void;
  onSaveEdit: (assetName: string, amountInr: string) => void;
}

function ReviewRow({ row, onConfirm, onReject, onEdit, onSaveEdit }: ReviewRowProps) {
  const [editName, setEditName] = useState(row.editAssetName);
  const [editAmt, setEditAmt] = useState(row.editAmountInr);
  const isLowConfidence = row.confidenceScore !== null && parseFloat(row.confidenceScore) < 0.8;

  if (row.localStatus === "editing") {
    return (
      <tr className="bg-muted/30">
        <td className="text-muted-foreground py-3 pr-4 text-xs">{formatTableDate(row.date)}</td>
        <td className="py-2 pr-4" colSpan={4}>
          <input
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            className="border-input bg-background w-full rounded border px-2 py-1 text-sm"
          />
        </td>
        <td className="py-2 pr-4 text-right">{formatQuantity(row.quantity)}</td>
        <td className="py-2 pr-4 text-right">{formatPrice(row.price, row.nativeCurrency)}</td>
        <td className="py-2 pr-4">
          <input
            value={editAmt}
            onChange={(e) => setEditAmt(e.target.value)}
            className="border-input bg-background w-full rounded border px-2 py-1 text-right text-sm"
          />
        </td>
        <td className="py-2 text-right">
          <div className="flex items-center justify-end gap-1">
            <button
              onClick={() => onSaveEdit(editName, editAmt)}
              className="rounded-lg bg-green-500/20 px-2 py-1 text-xs font-medium text-green-400 transition-colors hover:bg-green-500/30"
            >
              Save
            </button>
            <button
              onClick={onReject}
              className="text-muted-foreground rounded-lg p-1 transition-colors hover:text-red-400"
              title="Reject"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td className="text-muted-foreground py-3 pr-4 text-xs">{formatTableDate(row.date)}</td>
      <td className="py-3 pr-4 font-medium">{row.assetName}</td>
      <td className="text-muted-foreground py-3 pr-4">{row.platform}</td>
      <td className="text-muted-foreground py-3 pr-4">{row.personName}</td>
      <td className="py-3 pr-4">
        <Badge className={cn("border text-xs", CATEGORY_BADGE[row.categoryName] ?? DEFAULT_BADGE)}>
          {row.categoryName}
        </Badge>
      </td>
      <td className="text-muted-foreground py-3 pr-4 text-right">{formatQuantity(row.quantity)}</td>
      <td className="text-muted-foreground py-3 pr-4 text-right">
        {formatPrice(row.price, row.nativeCurrency)}
      </td>
      <td className="py-3 pr-4 text-right font-medium">{formatAmount(row.amountInr)}</td>
      <td className="py-3 text-right">
        {row.localStatus === "confirmed" ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-green-500/20 px-3 py-1 text-xs font-medium text-green-400">
            <Check className="h-3 w-3" />
            Done
          </span>
        ) : (
          <div className="flex items-center justify-end gap-1">
            {isLowConfidence ? (
              <button
                onClick={onEdit}
                className="inline-flex items-center gap-1 rounded-lg border border-amber-400/50 px-3 py-1 text-xs font-medium text-amber-400 transition-colors hover:bg-amber-400/10"
              >
                <Pencil className="h-3 w-3" />
                Edit
              </button>
            ) : (
              <button
                onClick={onConfirm}
                className="border-border hover:bg-muted inline-flex items-center gap-1 rounded-lg border px-3 py-1 text-xs font-medium transition-colors"
              >
                <Check className="h-3 w-3" />
                Confirm
              </button>
            )}
            <button
              onClick={onReject}
              className="text-muted-foreground rounded-lg p-1 transition-colors hover:text-red-400"
              title="Reject"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}
