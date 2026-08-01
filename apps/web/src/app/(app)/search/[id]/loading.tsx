import { Skeleton } from "@/components/ui/skeleton";

/** Affiché pendant que le Server Component du détail récupère l'annonce, la média et l'analyse. */
export default function ListingDetailLoading() {
  return (
    <div className="space-y-6" role="status" aria-label="Chargement de l'annonce">
      <Skeleton className="h-4 w-32" />

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-[200px_1fr]">
        <Skeleton className="aspect-square w-full rounded-lg" />
        <div className="space-y-4">
          <Skeleton className="h-6 w-2/3" />
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        </div>
      </div>

      <Skeleton className="h-32 w-full rounded-lg" />
    </div>
  );
}
