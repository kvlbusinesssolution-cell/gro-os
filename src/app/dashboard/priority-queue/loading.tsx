import { Container } from "@/components/ui/container";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/** Streamed instantly while page.tsx's several DB queries resolve — mirrors its real layout so there's no visual jump once data lands. */
export default function PriorityQueueLoading() {
  return (
    <main className="py-8">
      <Container className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-4 w-full max-w-xl" />
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} className="h-[70px] rounded-xl" />
          ))}
        </div>

        <Skeleton className="h-24 w-full rounded-xl" />

        <Card glass>
          <CardContent className="flex flex-col gap-3 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </CardContent>
        </Card>
      </Container>
    </main>
  );
}
