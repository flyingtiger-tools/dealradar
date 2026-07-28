/**
 * Même patron que `packages/ingestion/src/__tests__/fake-supabase.ts` —
 * copie locale volontaire (fichier de test interne, non exporté par
 * `@dealradar/ingestion`) plutôt qu'un import cross-paquet des internes de
 * test d'un autre paquet. Reproduit juste assez de postgrest-js
 * (select/insert/update/eq/contains/limit/maybeSingle, thenable) pour
 * exercer `process-analysis.ts` sans réseau.
 */

type Row = Record<string, unknown>;

interface QueryState {
  table: string;
  operation: "select" | "insert" | "update";
  filters: { column: string; value: unknown }[];
  containsFilters: { column: string; value: Row }[];
  payload?: Row;
  limitCount?: number;
  maybeSingle?: boolean;
}

export class FakeSupabase {
  tables: Record<string, Row[]> = {};

  seed(table: string, rows: Row[]): void {
    this.tables[table] = rows.map((r) => ({ ...r }));
  }

  table(name: string): Row[] {
    return this.tables[name] ?? [];
  }

  from(table: string) {
    this.tables[table] ??= [];
    const state: QueryState = { table, operation: "select", filters: [], containsFilters: [] };
    const execute = () => this.execute(state);

    const builder = {
      select() {
        return builder;
      },
      insert(payload: Row) {
        state.operation = "insert";
        state.payload = payload;
        return builder;
      },
      update(payload: Row) {
        state.operation = "update";
        state.payload = payload;
        return builder;
      },
      eq(column: string, value: unknown) {
        state.filters.push({ column, value });
        return builder;
      },
      contains(column: string, value: Row) {
        state.containsFilters.push({ column, value });
        return builder;
      },
      limit(count: number) {
        state.limitCount = count;
        return builder;
      },
      maybeSingle() {
        state.maybeSingle = true;
        return builder;
      },
      then(
        onFulfilled: (value: { data: unknown; error: unknown }) => unknown,
        onRejected?: (reason: unknown) => unknown,
      ) {
        try {
          return Promise.resolve(onFulfilled(execute()));
        } catch (error) {
          if (onRejected) return Promise.resolve(onRejected(error));
          throw error;
        }
      },
    };
    return builder;
  }

  private execute(state: QueryState): { data: unknown; error: unknown } {
    const rows = (this.tables[state.table] ??= []);

    const matches = (row: Row): boolean =>
      state.filters.every((f) => row[f.column] === f.value) &&
      state.containsFilters.every((f) => {
        const target = row[f.column] as Row | undefined;
        return target !== undefined && Object.entries(f.value).every(([k, v]) => target[k] === v);
      });

    if (state.operation === "insert") {
      const inserted = { id: state.payload!.id ?? Math.random().toString(36).slice(2), ...state.payload };
      rows.push(inserted);
      return { data: inserted, error: null };
    }

    if (state.operation === "update") {
      const targets = rows.filter(matches);
      for (const row of targets) Object.assign(row, state.payload);
      return { data: targets, error: null };
    }

    let result = rows.filter(matches);
    if (state.limitCount !== undefined) result = result.slice(0, state.limitCount);

    if (state.maybeSingle) {
      return { data: result[0] ?? null, error: null };
    }
    return { data: result, error: null };
  }
}
