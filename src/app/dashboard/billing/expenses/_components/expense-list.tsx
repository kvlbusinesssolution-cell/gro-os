"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "../../../_lib/format";
import { deleteExpenseEntry } from "../actions";

const CATEGORY_VARIANT: Record<string, "outline" | "accent" | "default" | "secondary"> = {
  MARKETING: "accent",
  SALES: "default",
  OTHER: "secondary",
};

export interface ExpenseRow {
  id: string;
  category: string;
  amount: number;
  incurredOn: Date;
  description: string | null;
}

export function ExpenseList({ expenses, currency }: { expenses: ExpenseRow[]; currency?: string | null }) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  if (expenses.length === 0) {
    return <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">No expenses logged yet.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {expenses.map((e) => (
        <Card key={e.id} glass>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="flex items-center gap-3">
              <Badge variant={CATEGORY_VARIANT[e.category] ?? "outline"}>{e.category}</Badge>
              <div>
                <p className="font-medium text-foreground">{formatCurrency(e.amount, currency)}</p>
                <p className="text-xs text-muted-foreground">
                  {e.incurredOn.toLocaleDateString()}
                  {e.description ? ` · ${e.description}` : ""}
                </p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                startTransition(async () => {
                  await deleteExpenseEntry(e.id);
                  router.refresh();
                })
              }
              aria-label="Delete expense"
            >
              <Trash2 className="size-4" />
            </Button>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
