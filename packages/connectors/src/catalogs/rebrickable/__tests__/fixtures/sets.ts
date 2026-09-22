/**
 * Fixtures — forme PUBLIQUEMENT documentée de l'API Rebrickable v3 (jamais
 * confirmée par un appel réel authentifié ce lot, `REBRICKABLE_API_KEY`
 * absente — voir `raw-types.ts`). PAS des données "inventées" au sens où
 * DealRadar l'entend ailleurs (aucune vente/prix fabriqué), mais leur
 * FORME reste non vérifiée en direct, contrairement à TCGdex/Open Facts.
 */
import type { RebrickableSet } from "../../raw-types";

export const DELOREAN_SET: RebrickableSet = {
  set_num: "10300-1",
  name: "Back to the Future Time Machine",
  year: 2020,
  theme_id: 682,
  num_parts: 1872,
  set_img_url: "https://cdn.rebrickable.com/media/sets/10300-1.jpg",
  set_url: "https://rebrickable.com/sets/10300-1/back-to-the-future-time-machine/",
  last_modified_dt: "2020-09-01T12:00:00.000Z",
};

export const MINIMAL_SET: RebrickableSet = {
  set_num: "6608-1",
};
