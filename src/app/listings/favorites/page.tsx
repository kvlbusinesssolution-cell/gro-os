import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { NavbarWithSession as Navbar } from "@/components/sections/navbar-with-session";
import { Footer } from "@/components/sections/footer";
import { Container } from "@/components/ui/container";
import { auth } from "@/auth";
import { listFavoriteListings } from "@/lib/listings/favorites";
import { ListingCard } from "../_components/listing-card";

export const metadata: Metadata = { title: "My Favorites — Business Directory" };

export default async function FavoritesPage() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect("/login?callbackUrl=%2Flistings%2Ffavorites");

  const listings = await listFavoriteListings(userId);

  return (
    <div className="theme-luxury">
      <Navbar />
      <main className="pt-16 sm:pt-24">
        <Container className="flex flex-col gap-8 py-12">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">My Favorites</h1>
            <p className="text-muted-foreground">Businesses you've saved from the directory.</p>
          </div>

          {listings.length === 0 ? (
            <p className="text-sm text-muted-foreground">No favorites yet — save a business from its listing page.</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {listings.map((listing) => (
                <ListingCard key={listing.slug} listing={listing} />
              ))}
            </div>
          )}
        </Container>
      </main>
      <Footer />
    </div>
  );
}
