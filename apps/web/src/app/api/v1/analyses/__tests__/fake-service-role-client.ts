/**
 * Double minimal du client Supabase service role, juste assez pour couvrir
 * les chaînes réellement utilisées par route.ts/[id]/route.ts. Même esprit
 * que `packages/ingestion/src/__tests__/fake-supabase.ts` : pas un mock
 * générique, un double qui connaît les appels exacts du code testé.
 */
export type Resolution = { data: unknown; error: unknown };

export interface FakeServiceRoleConfig {
  rpc?: (fn: string, args: Record<string, unknown>) => Resolution;
  onInsert?: (table: string, row: Record<string, unknown>) => Resolution;
  onSelect?: (table: string, filters: Record<string, unknown>) => Resolution;
}

export function createFakeServiceRoleClient(config: FakeServiceRoleConfig) {
  return {
    rpc: async (fn: string, args: Record<string, unknown>) =>
      config.rpc?.(fn, args) ?? { data: null, error: new Error(`rpc ${fn} non simulé`) },
    from(table: string) {
      const filters: Record<string, unknown> = {};
      let insertRow: Record<string, unknown> | null = null;

      const builder = {
        insert(row: Record<string, unknown>) {
          insertRow = row;
          return builder;
        },
        select(_columns: string) {
          return builder;
        },
        eq(column: string, value: unknown) {
          filters[column] = value;
          return builder;
        },
        async maybeSingle(): Promise<Resolution> {
          if (insertRow) {
            return config.onInsert?.(table, insertRow) ?? { data: null, error: new Error("insert non simulé") };
          }
          return config.onSelect?.(table, filters) ?? { data: null, error: new Error("select non simulé") };
        },
        async single(): Promise<Resolution> {
          return config.onSelect?.(table, filters) ?? { data: null, error: new Error("select non simulé") };
        },
      };
      return builder;
    },
  };
}
