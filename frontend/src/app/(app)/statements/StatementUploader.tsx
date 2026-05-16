"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Upload, FileText, Check, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { apiPostForm, apiPatch } from "@/lib/api";
import type { PendingTransaction, UploadResponse } from "@/types";

const INVESTMENT_PLATFORMS = [
  { value: "zerodha", label: "Zerodha" },
  { value: "indmoney", label: "INDMoney" },
  { value: "coinswitch", label: "CoinSwitch" },
  { value: "paytm-money", label: "PayTM Money" },
  { value: "employer-stock", label: "Employer stock" },
];

const EXPENSE_PLATFORMS = [{ value: "hdfc-bank", label: "HDFC Bank" }];

const CATEGORY_BADGE: Record<string, string> = {
  "US Equity": "bg-blue-500/20 text-blue-300 border-blue-400/30",
  "Indian Equity": "bg-cyan-500/20 text-cyan-300 border-cyan-400/30",
  "Mutual Fund": "bg-purple-500/20 text-purple-300 border-purple-400/30",
  "Liquid Fund": "bg-teal-500/20 text-teal-300 border-teal-400/30",
  ETF: "bg-teal-500/20 text-teal-300 border-teal-400/30",
  Crypto: "bg-green-500/20 text-green-300 border-green-400/30",
  "Employer RSU": "bg-orange-500/20 text-orange-300 border-orange-400/30",
  Gold: "bg-yellow-500/20 text-yellow-300 border-yellow-400/30",
};

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

type Phase = "idle" | "uploading" | "reviewing" | "error";

interface Props {
  personId: number | null;
}

export function StatementUploader({ personId }: Props) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isDragging, setIsDragging] = useState(false);
  const [statementType, setStatementType] = useState<"investment" | "expense">("investment");
  const [platform, setPlatform] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [filename, setFilename] = useState("");
  const [totalParsed, setTotalParsed] = useState(0);
  const [rows, setRows] = useState<LocalRow[]>([]);

  const platforms = statementType === "investment" ? INVESTMENT_PLATFORMS : EXPENSE_PLATFORMS;
  const confirmedCount = rows.filter((r) => r.localStatus === "confirmed").length;
  const visibleRows = rows.filter((r) => r.localStatus !== "rejected");

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
    if (!selectedFile || !platform) return;
    setPhase("uploading");
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
      setFilename(selectedFile.name);
      setTotalParsed(result.inserted + result.skipped);
      setRows(
        result.transactions.map((t) => ({
          ...t,
          localStatus: t.status === "confirmed" ? "confirmed" : "pending",
          editAssetName: t.assetName,
          editAmountInr: t.amountInr,
        })),
      );
      setPhase("reviewing");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Upload failed");
      setPhase("error");
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
      await apiPatch(`/statements/${id}`, { action: "confirm", assetName, amountInr });
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
                    : "HDFC Bank account statement (PDF)"}
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
            <Button
              onClick={() => void handleUpload()}
              disabled={!platform || phase === "uploading"}
            >
              {phase === "uploading" ? "Parsing…" : "Upload & Parse"}
            </Button>
          </div>
        )}

        {phase === "error" && <p className="mt-3 text-sm text-red-500">{errorMsg}</p>}
      </div>

      {/* Parsed file + HITL review */}
      {phase === "reviewing" && rows.length > 0 && (
        <div className="rounded-xl border">
          {/* File info row */}
          <div className="flex items-center justify-between border-b px-6 py-3">
            <div className="flex items-center gap-2">
              <FileText className="text-muted-foreground h-4 w-4 shrink-0" />
              <span className="text-sm font-medium">{filename}</span>
            </div>
            <span className="rounded-full bg-green-500/15 px-2.5 py-0.5 text-xs font-medium text-green-400">
              Parsed · {totalParsed} entries
            </span>
          </div>

          {/* Review header */}
          <div className="flex items-center justify-between px-6 py-4">
            <h3 className="text-sm font-semibold">
              HITL Review — {statementType === "investment" ? "Investment" : "Expense"} entries
            </h3>
            <div className="flex items-center gap-3">
              <span className="text-muted-foreground text-xs">
                {confirmedCount} of {visibleRows.length} confirmed
              </span>
              <div className="bg-muted h-1.5 w-24 overflow-hidden rounded-full">
                <div
                  className="h-full rounded-full bg-green-500 transition-all duration-300"
                  style={{
                    width: `${visibleRows.length ? (confirmedCount / visibleRows.length) * 100 : 0}%`,
                  }}
                />
              </div>
            </div>
          </div>

          {/* Table */}
          <div className="px-6 pb-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground border-b text-xs">
                  <th className="pb-2 text-left font-medium">Date</th>
                  <th className="pb-2 text-left font-medium">Asset</th>
                  <th className="pb-2 text-left font-medium">Platform</th>
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

            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setPhase("idle")}>
                Review all
              </Button>
              <Button size="sm" onClick={handleCommit}>
                Commit confirmed
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
        <td className="py-2 pr-4" colSpan={3}>
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
          <div className="flex justify-end gap-1">
            <button
              onClick={() => onSaveEdit(editName, editAmt)}
              className="rounded-lg bg-green-500/20 px-2 py-1 text-xs font-medium text-green-400 transition-colors hover:bg-green-500/30"
            >
              Save
            </button>
            <button
              onClick={onReject}
              className="text-muted-foreground hover:text-foreground rounded-lg px-2 py-1 text-xs transition-colors"
            >
              Skip
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
      <td className="py-3 pr-4">
        <Badge
          className={cn(
            "border text-xs",
            CATEGORY_BADGE[row.categoryName] ?? "bg-secondary text-secondary-foreground",
          )}
        >
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
        ) : isLowConfidence ? (
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
      </td>
    </tr>
  );
}
