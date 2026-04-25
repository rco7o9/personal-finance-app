"use client";

import { useRouter } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PortfolioAsset } from "@/types";

interface Props {
  assets: PortfolioAsset[];
  currentAssetId: number;
}

export function AssetSelector({ assets, currentAssetId }: Props) {
  const router = useRouter();

  function handleChange(assetId: string | null) {
    if (!assetId) return;
    router.push(`/portfolio/assets/${assetId}`);
  }

  return (
    <Select value={String(currentAssetId)} onValueChange={handleChange}>
      <SelectTrigger className="w-72">
        <SelectValue placeholder="Select asset" />
      </SelectTrigger>
      <SelectContent>
        {assets.map((a) => (
          <SelectItem key={a.id} value={String(a.id)}>
            {a.name}
            <span className="text-muted-foreground ml-2 text-xs">
              {a.assetClass} · {a.platform}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
