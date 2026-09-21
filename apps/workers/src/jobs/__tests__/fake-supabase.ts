/**
 * Même patron que `packages/ingestion/src/__tests__/fake-supabase.ts` —
 * copie locale volontaire (fichier de test interne, non exporté par
 * `@dealradar/ingestion`) plutôt qu'un import cross-paquet des internes de
 * test d'un autre paquet. Reproduit juste assez de postgrest-js
 * (select/insert/update/upsert/eq/contains/lte/gte/or/order/limit/
 * maybeSingle/rpc, thenable) pour exercer `process-analysis.ts` ET
 * `refresh-due-research-targets.ts` (LOT "Close the Refresh Loop") sans
 * réseau — étendue ce lot avec `.or()`/`.lte()`/`.gte()`/`.order()`
 * multi-colonnes/`.rpc()`, mêmes ajouts que le double de `packages/
 * ingestion` (voir son en-tête pour le détail des garanties).
 */

type Row = Record<string, unknown>;

interface QueryState {
  table: string;
  operation: "select" | "insert" | "update" | "upsert";
  filters: { column: string; value: unknown }[];
  containsFilters: { column: string; value: Row }[];
  lteFilters: { column: string; value: unknown }[];
  gteFilters: { column: string; value: unknown }[];
  orFilters: { column: string; op: "lte" | "gte" | "is"; value: unknown }[];
  payload?: Row | Row[];
  onConflict?: string[];
  orderBy?: { column: string; ascending: boolean; nullsFirst?: boolean }[];
  limitCount?: number;
  single?: boolean;
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

  private rpcHandlers: Record<string, (params: Row) => { data: unknown; error: unknown }> = {};

  registerRpc(name: string, handler: (params: Row) => { data: unknown; error: unknown }): void {
    this.rpcHandlers[name] = handler;
  }

  rpc(name: string, params: Row) {
    const handler = this.rpcHandlers[name];
    const result = handler ? handler(params) : { data: null, error: { message: `RPC non simulée : ${name}` } };
    return {
      then(onFulfilled: (value: { data: unknown; error: unknown }) => unknown, onRejected?: (reason: unknown) => unknown) {
        try {
          return Promise.resolve(onFulfilled(result));
        } catch (error) {
          if (onRejected) return Promise.resolve(onRejected(error));
          throw error;
        }
      },
    };
  }

  from(table: string) {
    this.tables[table] ??= [];
    const state: QueryState = { table, operation: "select", filters: [], containsFilters: [], lteFilters: [], gteFilters: [], orFilters: [] };
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
      upsert(payload: Row | Row[], opts?: { onConflict?: string }) {
        state.operation = "upsert";
        state.payload = payload;
        state.onConflict = opts?.onConflict?.split(",");
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
      lte(column: string, value: unknown) {
        state.lteFilters.push({ column, value });
        return builder;
      },
      gte(column: string, value: unknown) {
        state.gteFilters.push({ column, value });
        return builder;
      },
      or(expr: string) {
        for (const clause of expr.split(",")) {
          const [column, op, ...rest] = clause.split(".");
          const value = rest.join(".");
          if (!column || !op) continue;
          if (op === "lte" || op === "gte" || op === "is") {
            state.orFilters.push({ column, op, value: value === "null" ? null : value });
          }
        }
        return builder;
      },
      order(column: string, opts?: { ascending?: boolean; nullsFirst?: boolean }) {
        state.orderBy ??= [];
        state.orderBy.push({ column, ascending: opts?.ascending ?? true, nullsFirst: opts?.nullsFirst });
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
      state.containsFilters.every((f) => {
        const target = row[f.column] as Row | undefined;
        return target !== undefined && Object.entries(f.value).every(([k, v]) => target[k] === v);
      }) &&
      state.lteFilters.every((f) => row[f.column] !== null && row[f.column] !== undefined && String(row[f.column]) <= String(f.value)) &&
      state.gteFilters.every((f) => row[f.column] !== null && row[f.column] !== undefined && String(row[f.column]) >= String(f.value)) &&
      (state.orFilters.length === 0 ||
        state.orFilters.some((f) => {
          const rv = row[f.column];
          if (f.op === "is") return f.value === null ? rv === null || rv === undefined : rv === f.value;
          if (f.op === "lte") return rv !== null && rv !== undefined && String(rv) <= String(f.value);
          return rv !== null && rv !== undefined && String(rv) >= String(f.value);
        }));

    if (state.operation === "insert") {
      const payloads = Array.isArray(state.payload) ? state.payload : [state.payload!];
      const inserted = payloads.map((p) => ({ id: p.id ?? Math.random().toString(36).slice(2), ...p }));
      rows.push(...inserted);
      return { data: state.single ? inserted[0] : inserted, error: null };
    }

    if (state.operation === "upsert") {
      const payloads = Array.isArray(state.payload) ? state.payload : [state.payload!];
      const onConflict = state.onConflict ?? ["id"];
      const upserted: Row[] = [];
      for (const p of payloads) {
        const existing = rows.find((row) => onConflict.every((col) => row[col] === p[col]));
        if (existing) {
          Object.assign(existing, p);
          upserted.push(existing);
        } else {
          const inserted = { id: p.id ?? Math.random().toString(36).slice(2), ...p };
          rows.push(inserted);
          upserted.push(inserted);
        }
      }
      return { data: state.single ? upserted[0] : upserted, error: null };
    }

    if (state.operation === "update") {
      const targets = rows.filter(matches);
      for (const row of targets) Object.assign(row, state.payload as Row);
      return { data: targets, error: null };
    }

    let result = rows.filter(matches);
    if (state.orderBy?.length) {
      const orderBy = state.orderBy;
      result = [...result].sort((a, b) => {
        for (const { column, ascending, nullsFirst } of orderBy) {
          const av = a[column];
          const bv = b[column];
          if (av === bv) continue;
          if (av === null || av === undefined) return nullsFirst ? -1 : 1;
          if (bv === null || bv === undefined) return nullsFirst ? 1 : -1;
          return ((av as never) > (bv as never) ? 1 : -1) * (ascending ? 1 : -1);
        }
        return 0;
      });
    }
    if (state.limitCount !== undefined) result = result.slice(0, state.limitCount);

    if (state.maybeSingle) {
      return { data: result[0] ?? null, error: null };
    }
    return { data: result, error: null };
  }
}
