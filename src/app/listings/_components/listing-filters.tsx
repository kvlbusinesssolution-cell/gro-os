import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { NearMeButton } from "./near-me-button";

/** Plain GET form — filtering works without client JS, same as any classic directory search. */
export function ListingFilters({
  q,
  category,
  city,
  openNow,
  nearMe,
  categories,
  cities,
}: {
  q: string;
  category: string;
  city: string;
  openNow: boolean;
  nearMe: boolean;
  categories: string[];
  cities: string[];
}) {
  return (
    <form method="get" action="/listings" className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4">
      <Input name="q" defaultValue={q} placeholder="Search businesses…" className="min-w-48 flex-1" />
      <Select name="category" defaultValue={category} className="w-44">
        <option value="">All categories</option>
        {categories.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </Select>
      <Select name="city" defaultValue={city} className="w-44">
        <option value="">All cities</option>
        {cities.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </Select>
      <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <input type="checkbox" name="openNow" value="1" defaultChecked={openNow} className="size-4 rounded border-border" />
        Open now
      </label>
      <Button type="submit" size="sm">
        Search
      </Button>
      <NearMeButton q={q} category={category} city={city} openNow={openNow} active={nearMe} />
    </form>
  );
}
