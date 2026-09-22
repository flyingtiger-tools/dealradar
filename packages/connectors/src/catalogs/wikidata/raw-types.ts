import { z } from "zod";

/**
 * Schéma Zod du format standard "SPARQL Query Results JSON Format"
 * (W3C) tel que renvoyé par `query.wikidata.org/sparql` — CONFIRMÉ par
 * appel réel ce lot (LOT "Free/Open Sources + Real Readiness + Live Smoke
 * Tests", section 5/13) : requête exacte sur `wdt:P3962` ("Global Trade
 * Item Number") pour le GTIN `00640520098905` → `Q29972750`, "Apple iPhone
 * 7 128GB Jet Black", fabricant "Apple Inc.".
 */
export const sparqlBindingValueSchema = z.object({
  type: z.string(),
  value: z.string(),
  "xml:lang": z.string().optional(),
});

export const sparqlResultsSchema = z.object({
  head: z.object({ vars: z.array(z.string()) }),
  results: z.object({ bindings: z.array(z.record(z.string(), sparqlBindingValueSchema)) }),
});
export type SparqlResults = z.infer<typeof sparqlResultsSchema>;
