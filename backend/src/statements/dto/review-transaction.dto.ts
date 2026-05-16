import { IsIn, IsOptional, IsString } from "class-validator";

// action semantics:
//   confirm → status = 'confirmed'   (row accepted as-is)
//   edit    → status = 'edited'      (row accepted with user-supplied corrections)
//   reject  → row deleted
export class ReviewTransactionDto {
  @IsIn(["confirm", "edit", "reject"])
  action: "confirm" | "edit" | "reject";

  // Required when action = 'edit'; ignored for confirm/reject.
  @IsOptional()
  @IsString()
  assetName?: string;

  @IsOptional()
  @IsString()
  amountInr?: string;
}
