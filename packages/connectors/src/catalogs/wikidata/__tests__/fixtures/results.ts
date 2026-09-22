/**
 * Fixtures — réponse SPARQL RÉELLE capturée depuis `query.wikidata.org`
 * (LOT "Free/Open Sources + Real Readiness + Live Smoke Tests", section
 * 5/13) : `SELECT ?item ?itemLabel ?manufacturerLabel WHERE { ?item
 * wdt:P3962 "00640520098905" . OPTIONAL { ?item wdt:P176 ?manufacturer . }
 * SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } }`.
 * Jamais de données inventées.
 */
import type { SparqlResults } from "../../raw-types";

export const IPHONE_7_GTIN_RESULT: SparqlResults = {
  head: { vars: ["item", "itemLabel", "manufacturerLabel"] },
  results: {
    bindings: [
      {
        item: { type: "uri", value: "http://www.wikidata.org/entity/Q29972750" },
        itemLabel: { type: "literal", value: "Apple iPhone 7 128GB Jet Black", "xml:lang": "en" },
        manufacturerLabel: { type: "literal", value: "Apple Inc.", "xml:lang": "en" },
      },
    ],
  },
};

/** GTIN sans aucune entité correspondante — résultat vide réel. */
export const EMPTY_RESULT: SparqlResults = {
  head: { vars: ["item", "itemLabel"] },
  results: { bindings: [] },
};
