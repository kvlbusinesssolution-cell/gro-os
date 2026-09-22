import { Container } from "@/components/ui/container";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/** Streamed instantly while page.tsx's many-relation Company query (+ AI conversation summary, next-action suggestion) resolves. */
export default function CompanyDetailLoading() {
  return (
    <main className="py-8">
      <Container className="flex flex-col gap-6">
        <Skeleton className="h-4 w-36" />

        <div className="flex items-center gap-3">
          <Skeleton className="size-12 rounded-xl" />
          <div className="flex flex-col gap-2">
            <Skeleton className="h-7 w-56" />
            <Skeleton className="h-5 w-40" />
          </div>
        </div>

        <Skeleton className="h-9 w-full max-w-xl" />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="flex flex-col gap-4 lg:col-span-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-32 w-full rounded-xl" />
            ))}
          </div>
          <div className="flex flex-col gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Card key={i} glass>
                <CardContent className="p-4">
                  <Skeleton className="h-24 w-full" />
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </Container>
    </main>
  );
}
