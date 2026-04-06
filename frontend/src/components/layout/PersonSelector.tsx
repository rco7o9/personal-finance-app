"use client";

// CLIENT component — uses useState, useEffect, and localStorage (browser APIs).
// This component:
// 1. Fetches the list of persons from NestJS on mount
// 2. Persists the selected person to localStorage
// 3. Syncs the selection into the URL as ?personId=X so server components can read it

import { useState, useEffect } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Person = { id: number; name: string };

const STORAGE_KEY = "pfa_selected_person_id";

export function PersonSelector() {
  const [persons, setPersons] = useState<Person[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Load persons from NestJS on mount
  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_API_URL}/persons`)
      .then((r) => r.json())
      .then((data: Person[]) => {
        setPersons(data);
        // Restore previously selected person from localStorage
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored && data.some((p) => p.id === Number(stored))) {
          setSelectedId(stored);
        } else if (data.length > 0) {
          setSelectedId(String(data[0].id));
        }
      })
      .catch(() => {
        // Backend not yet available (e.g. before DB is set up) — fail silently
      });
  }, []);

  function handleSelect(value: string | null) {
    if (!value) return;
    setSelectedId(value);
    localStorage.setItem(STORAGE_KEY, value);

    // Sync personId into the URL so server components on the current page
    // re-fetch with the new person. Server components receive personId via
    // searchParams prop — they can't read localStorage.
    const params = new URLSearchParams(searchParams.toString());
    params.set("personId", value);
    router.push(`${pathname}?${params.toString()}`);
  }

  if (persons.length === 0) return null;

  return (
    <Select value={selectedId} onValueChange={handleSelect}>
      <SelectTrigger className="w-36 text-sm">
        <SelectValue placeholder="Select person" />
      </SelectTrigger>
      <SelectContent>
        {persons.map((p) => (
          <SelectItem key={p.id} value={String(p.id)}>
            {p.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
