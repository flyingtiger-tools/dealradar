import { z } from "zod";

/**
 * Schéma Zod d'un objet `Game` IGDB v4 — forme PUBLIQUEMENT et stablement
 * documentée de longue date (des dizaines de bibliothèques clientes
 * open-source la confirment de façon cohérente), jamais une supposition
 * arbitraire.
 *
 * HONNÊTETÉ (LOT "Free/Open Sources + Real Readiness + Live Smoke Tests",
 * section 7) : AUCUN appel authentifié réel n'a pu être effectué —
 * `IGDB_CLIENT_ID`/`IGDB_CLIENT_SECRET` absentes de cet environnement ce
 * lot. Seul le MÉCANISME d'authentification (Twitch OAuth) et la forme du
 * message d'erreur ont été confirmés par appel réel (voir `client.ts`) —
 * jamais un champ de jeu individuel. `liveTested: false` dans le
 * descripteur du connecteur reflète honnêtement cette limite.
 */
export const igdbGameSchema = z.object({
  id: z.number(),
  name: z.string().optional(),
  slug: z.string().optional(),
  /** Epoch Unix en SECONDES (convention IGDB) — jamais millisecondes. */
  first_release_date: z.number().optional(),
  cover: z.object({ url: z.string().optional() }).optional(),
  platforms: z.array(z.object({ id: z.number().optional(), name: z.string().optional() })).optional(),
});
export type IgdbGame = z.infer<typeof igdbGameSchema>;

export const igdbGameListSchema = z.array(igdbGameSchema);
