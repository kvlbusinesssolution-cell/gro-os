"use client";

import { useMemo, useState } from "react";
import { ArrowUpDown } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { filterBreakdownRows, sortBreakdownRows } from "../_lib/acquisition-display";

export interface BreakdownColumn<Row> {
  key: keyof Row;
  label: string;
  align?: "right";
  format?: (row: Row) => string;
}

interface AcquisitionBreakdownTableProps<Row extends Record<string, unknown>> {
  title: string;
  description?: string;
  rows: Row[];
  columns: BreakdownColumn<Row>[];
  /** Column used both as the free-text filter target and the row `key`. */
  filterKey: keyof Row;
  defaultSortKey: keyof Row;
  emptyMessage: string;
}

/**
 * Real, client-side sortable + filterable breakdown table for the
 * Acquisition Overview section (/dashboard/analytics) — one generic
 * component reused for bySource/byIndustry/byCountry/byService, all of
 * which share the same shape (a name column plus a handful of real counts/
 * revenue). Sorting/filtering are pure functions from acquisition-display.ts
 * so they stay unit-testable outside React (see acquisition-display.test.ts);
 * this component only owns the UI state (query, sort key, sort direction).
 */
export function AcquisitionBreakdownTable<Row extends Record<string, unknown>>({
  title,
  description,
  rows,
  columns,
  filterKey,
  defaultSortKey,
  emptyMessage,
}: AcquisitionBreakdownTableProps<Row>) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<keyof Row>(defaultSortKey);
  const [direction, setDirection] = useState<"asc" | "desc">("desc");

  const visibleRows = useMemo(
    () => sortBreakdownRows(filterBreakdownRows(rows, query, filterKey), sortKey, direction),
    [rows, query, filterKey, sortKey, direction],
  );

  function toggleSort(key: keyof Row) {
    if (key === sortKey) {
      setDirection((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setDirection("desc");
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="text-sm font-medium text-foreground">{title}</p>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyMessage}</p>
      ) : (
        <>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Filter ${title.toLowerCase()}…`}
            className="h-9 w-full max-w-xs"
            aria-label={`Filter ${title}`}
          />
          {visibleRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No rows match &ldquo;{query}&rdquo;.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  {columns.map((col) => (
                    <TableHead key={String(col.key)} className={col.align === "right" ? "text-right" : undefined}>
                      <button
                        type="button"
                        onClick={() => toggleSort(col.key)}
                        className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
                      >
                        {col.label}
                        <ArrowUpDown className={`size-3 ${sortKey === col.key ? "text-foreground" : "text-muted-foreground/50"}`} />
                      </button>
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleRows.map((row) => (
                  <TableRow key={String(row[filterKey])}>
                    {columns.map((col) => (
                      <TableCell key={String(col.key)} className={col.align === "right" ? "text-right" : undefined}>
                        {col.format ? col.format(row) : String(row[col.key] ?? "")}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </>
      )}
    </div>
  );
}
