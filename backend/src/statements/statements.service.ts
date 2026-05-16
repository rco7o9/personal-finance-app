import { HttpException, HttpStatus, Injectable, Inject } from "@nestjs/common";
import { Pool } from "pg";

export type StatementMetadata = {
  type: "investment" | "expense";
  platform: string;
  format: "csv" | "xlsx" | "pdf";
  personId: number;
};

export type PendingRow = {
  id: number;
  date: string;
  assetName: string;
  platform: string;
  categoryName: string;
  quantity: string | null;
  price: string | null;
  nativeCurrency: string | null;
  amountInr: string;
  status: string;
  confidenceScore: string | null;
  verificationStatus: string | null;
};

export type UploadResult = {
  inserted: number;
  skipped: number;
  verificationStatus: string;
  transactions: PendingRow[];
};

@Injectable()
export class StatementsService {
  constructor(@Inject("DB_POOL") private readonly pool: Pool) {}

  // Stubs — implemented in T-4 and T-5.
  // Synchronous throw is assignable to Promise<T>; no await needed until real logic lands.

  uploadStatement(file: Express.Multer.File, metadataJson: string): Promise<UploadResult> {
    void file;
    void metadataJson;
    throw new HttpException("Not implemented", HttpStatus.NOT_IMPLEMENTED);
  }

  getPending(personId: number, type?: string): Promise<PendingRow[]> {
    void personId;
    void type;
    throw new HttpException("Not implemented", HttpStatus.NOT_IMPLEMENTED);
  }

  reviewTransaction(
    id: number,
    action: "confirm" | "edit" | "reject",
    updates?: { assetName?: string; amountInr?: string },
  ): Promise<void> {
    void id;
    void action;
    void updates;
    throw new HttpException("Not implemented", HttpStatus.NOT_IMPLEMENTED);
  }
}
