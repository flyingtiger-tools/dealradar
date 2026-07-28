/**
 * Double minimal simulant juste assez de `listings` pour tester
 * `anonymizeEbaySellerData` (select par `raw_payload->>sellerUsername` /
 * `seller_external_id`, puis `update` par `id`) — une mini-table en
 * mémoire, pas un mock générique, dans le même esprit que les autres
 * doubles Supabase du projet.
 */
export interface FakeListingRow {
  id: string;
  raw_payload: Record<string, unknown> | null;
  seller_external_id: string | null;
}

export function createFakeListingsSupabase(initialRows: FakeListingRow[]) {
  const rows = new Map(initialRows.map((row) => [row.id, { ...row }]));

  return {
    _rows: rows,
    from(table: string) {
      if (table !== "listings") throw new Error(`table non simulée : ${table}`);

      return {
        select(_columns: string) {
          return {
            eq(column: string, value: unknown) {
              const matched = [...rows.values()].filter((row) => {
                if (column === "raw_payload->>sellerUsername") {
                  return row.raw_payload && (row.raw_payload as Record<string, unknown>).sellerUsername === value;
                }
                if (column === "seller_external_id") {
                  return row.seller_external_id === value;
                }
                throw new Error(`colonne non simulée : ${column}`);
              });
              return Promise.resolve({ data: matched.map((r) => ({ ...r })), error: null });
            },
          };
        },
        update(patch: Partial<FakeListingRow>) {
          return {
            eq(column: string, value: unknown) {
              if (column !== "id") throw new Error(`update par colonne non simulée : ${column}`);
              const existing = rows.get(value as string);
              if (existing) rows.set(value as string, { ...existing, ...patch });
              return Promise.resolve({ data: null, error: null });
            },
          };
        },
      };
    },
  };
}
