/**
 * Fixtures — forme PUBLIQUEMENT documentée/stable de longue date de l'API
 * IGDB v4 (jamais confirmée par un appel authentifié réel ce lot,
 * `IGDB_CLIENT_ID`/`IGDB_CLIENT_SECRET` absentes — voir `raw-types.ts`).
 */
import type { IgdbGame } from "../../raw-types";

export const HALO_INFINITE: IgdbGame = {
  id: 126459,
  name: "Halo Infinite",
  slug: "halo-infinite",
  first_release_date: 1638921600,
  cover: { url: "//images.igdb.com/igdb/image/upload/t_thumb/co3zkr.jpg" },
  platforms: [{ id: 6, name: "PC (Microsoft Windows)" }, { id: 169, name: "Xbox Series X|S" }],
};

export const MINIMAL_GAME: IgdbGame = { id: 1 };
