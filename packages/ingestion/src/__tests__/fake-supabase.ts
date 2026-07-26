/**
 * Faux client Supabase minimal pour les tests unitaires du paquet ingestion.
 * Reproduit juste assez de la surface du query builder postgrest-js
 * (select/insert/update/eq/in/order/limit/single/maybeSingle, thenable)
 * pour exercer persist-listing/run-ingestion/analyze-listing sans réseau.
 */

type Row = Record<string, unknown>;

interface QueryState {
  table: string;
  operation: "select" | "insert" | "update";
  filters: { column: string; value: unknown }[];
  notFilters: { column: string; value: unknown }[];
  inFilters: { column: string; values: unknown[] }[];
  containsFilters: { column: string; value: Row }[];
  payload?: Row | Row[];
  orderBy?: { column: string; ascending: boolean };
  limitCount?: number;
  single?: boolean;
  maybeSingle?: boolean;
}

function randomId(): string {
  return Math.random().toString(36).slice(2);
}

export class FakeSupabase {
  tables: Record<string, Row[]> = {};

  seed(table: string, rows: Row[]): void {
    this.tables[table] = rows.map((r) => ({ ...r }));
  }

  /** Accès sûr pour les assertions de test (évite noUncheckedIndexedAccess ailleurs). */
  table(name: string): Row[] {
    return this.tables[name] ?? [];
  }

  from(table: string) {
    this.tables[table] ??= [];
    const state: QueryState = {
      table,
      operation: "select",
      filters: [],
      notFilters: [],
      inFilters: [],
      containsFilters: [],
    };
    const execute = () => this.execute(state);

    const builder = {
      select() {
        return builder;
      },
      insert(payload: Row | Row[]) {
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
      neq(column: string, value: unknown) {
        state.notFilters.push({ column, value });
        return builder;
      },
      in(column: string, values: unknown[]) {
        state.inFilters.push({ column, values });
        return builder;
      },
      contains(column: string, value: Row) {
        state.containsFilters.push({ column, value });
        return builder;
      },
      order(column: string, opts?: { ascending?: boolean }) {
        state.orderBy = { column, ascending: opts?.ascending ?? true };
        return builder;
      },
      limit(count: number) {
        state.limitCount = count;
        return builder;
      },
      single() {
        state.single = true;
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
      state.notFilters.every((f) => row[f.column] !== f.value) &&
      state.inFilters.every((f) => f.values.includes(row[f.column])) &&
      state.containsFilters.every((f) => {
        const target = row[f.column] as Row | undefined;
        return target !== undefined && Object.entries(f.value).every(([k, v]) => target[k] === v);
      });

    if (state.operation === "insert") {
      const payloads = Array.isArray(state.payload) ? state.payload : [state.payload!];
      const inserted = payloads.map((p) => ({ id: p.id ?? randomId(), ...p }));
      rows.push(...inserted);
      return { data: state.single ? inserted[0] : inserted, error: null };
    }

    if (state.operation === "update") {
      const targets = rows.filter(matches);
      for (const row of targets) Object.assign(row, state.payload);
      return { data: targets, error: null };
    }

    let result = rows.filter(matches);
    if (state.orderBy) {
      const { column, ascending } = state.orderBy;
      result = [...result].sort((a, b) => {
        const av = a[column];
        const bv = b[column];
        if (av === bv) return 0;
        return ((av as never) > (bv as never) ? 1 : -1) * (ascending ? 1 : -1);
      });
    }
    if (state.limitCount !== undefined) result = result.slice(0, state.limitCount);

    if (state.single) {
      return result.length === 1 ? { data: result[0], error: null } : { data: null, error: { message: "not found" } };
    }
    if (state.maybeSingle) {
      return { data: result[0] ?? null, error: null };
    }
    return { data: result, error: null };
  }
}
