import type { SupabaseClient } from "@supabase/supabase-js";
import { categoryRowSchema, brandRowSchema, type Category, type Brand } from "@dealradar/core";

/** Tables select-only (RLS), vides tant que le Lot 3 n'a pas peuplé la taxonomie. */
export async function fetchCategories(supabase: SupabaseClient): Promise<Category[]> {
  const { data } = await supabase
    .from("categories")
    .select("id,parent_id,slug,name,path,depth")
    .order("path");
  return (data ?? []).map((row) => categoryRowSchema.parse(row));
}

export async function fetchBrands(supabase: SupabaseClient): Promise<Brand[]> {
  const { data } = await supabase.from("brands").select("id,slug,name,aliases").order("name");
  return (data ?? []).map((row) => brandRowSchema.parse(row));
}
