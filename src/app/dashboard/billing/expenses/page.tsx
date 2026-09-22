import { Container } from "@/components/ui/container";
import { prisma } from "@/lib/prisma";
import { requireActiveMembership } from "../../_lib/require-membership";
import { ExpenseForm } from "./_components/expense-form";
import { ExpenseList } from "./_components/expense-list";

export default async function ExpensesPage() {
  const { membership } = await requireActiveMembership("/dashboard/billing/expenses");
  const organizationId = membership.organizationId;
  const currency = membership.organization.currency;

  const expenses = await prisma.expenseEntry.findMany({
    where: { organizationId },
    orderBy: { incurredOn: "desc" },
  });

  return (
    <main className="py-8">
      <Container className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Expenses</h1>
            <p className="text-sm text-muted-foreground">
              Manually-logged marketing and sales spend — the real input behind this org&rsquo;s CAC.
            </p>
          </div>
          <ExpenseForm />
        </div>

        <ExpenseList
          expenses={expenses.map((e) => ({ id: e.id, category: e.category, amount: e.amount, incurredOn: e.incurredOn, description: e.description }))}
          currency={currency}
        />
      </Container>
    </main>
  );
}
