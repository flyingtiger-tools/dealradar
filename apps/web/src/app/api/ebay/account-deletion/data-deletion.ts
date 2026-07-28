import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Politique de suppression/anonymisation réelle (ADR 0011) — construite
 * après audit exhaustif du schéma existant **et** de ce que l'API Browse
 * eBay expose réellement, pas supposée.
 *
 * ── Ce que DealRadar persiste ─────────────────────────────────────────
 * Le connecteur eBay n'accède qu'en OAuth *application* (client
 * credentials), en lecture seule via la Browse API — jamais de connexion
 * au compte d'un utilisateur eBay final. Néanmoins, **DealRadar persiste
 * bien une donnée identifiant un compte eBay** : le nom d'utilisateur du
 * **vendeur** d'une annonce, dans `listings.raw_payload->>'sellerUsername'`
 * (JSONB, voir `packages/connectors/src/ebay/redact.ts`). Vérifié par grep
 * exhaustif sur toutes les migrations (`seller`, `username`, `user_id`,
 * `userId`, `eias`) : c'est la seule colonne de tout le schéma à contenir
 * une donnée identifiant un compte eBay — tous les autres `user_id`/
 * `seller_id` référencent `profiles`/`auth.users`, les comptes DealRadar
 * eux-mêmes.
 *
 * ── Ce que l'API Browse eBay expose réellement (audité, pas supposé) ──
 * Types `Seller` (item_summary) et `SellerDetail` (item) de l'API Browse
 * (developer.ebay.com/api-docs/buy/browse/types/gct:Seller et gct:
 * SellerDetail) : `username`, `feedbackScore`, `feedbackPercentage`,
 * `sellerAccountType` (BUSINESS/INDIVIDUAL — jamais un identifiant),
 * `sellerLegalInfo` (info légale entreprise, non capturée par notre
 * connecteur — `packages/connectors/src/ebay/raw-types.ts` ne la type pas).
 * **Aucun champ d'identifiant vendeur immuable n'existe dans ces deux
 * types** — `username` est la seule donnée d'identité disponible, et elle
 * est **mutable** (un utilisateur eBay peut changer son nom d'utilisateur).
 *
 * Conséquence directe : `listings.seller_external_id` (colonne dédiée,
 * réservée pour un identifiant immuable futur) reste **toujours `null`
 * pour eBay aujourd'hui** — pas par choix d'implémentation, mais parce
 * que l'API que nous utilisons ne fournit rien à y mettre
 * (`normalize.ts` fixe `seller.externalId: null` explicitement, en
 * connaissance de cause).
 *
 * ── Conséquence sur la corrélation d'une notification de suppression ──
 * La notification `MARKETPLACE_ACCOUNT_DELETION` peut fournir `username`,
 * `userId` et/ou `eiasToken` (identifiants internes côté eBay). Seul
 * `username` peut être comparé à une donnée que nous possédons
 * (`raw_payload->>'sellerUsername'`) — `userId`/`eiasToken` ne
 * correspondent à rien de stocké. **Il ne faut donc jamais présenter
 * cette suppression comme universellement complète** : (1) une
 * notification qui ne fournit pas `username` ne peut pas être rattachée
 * du tout ; (2) même quand `username` est fourni, si le vendeur a changé
 * de nom d'utilisateur entre la collecte de l'annonce et la suppression
 * de son compte, la corrélation échouera silencieusement (aucun moyen de
 * le détecter avec les données actuellement disponibles — limite assumée,
 * pas contournable sans un identifiant immuable qu'eBay ne fournit pas
 * aujourd'hui à ce niveau d'API).
 *
 * `correlationAttempted` distingue ces deux cas pour l'appelant :
 * `false` quand la notification ne fournit ni `username` ni `userId` (rien
 * à corréler, jamais de recherche déclenchée) ; `true` dès qu'une
 * recherche a été tentée, que 0 ou N annonces aient été trouvées.
 *
 * ── Migration future proposée, **non créée, non appliquée** ──────────
 * Si une version future de l'API Browse (ou un accès partenaire) expose un
 * identifiant vendeur immuable, `seller_external_id` est déjà prêt à le
 * recevoir sans changement de schéma. Aucune action nécessaire tant que
 * cette donnée n'existe pas côté eBay.
 *
 * ── Idempotence par construction ──────────────────────────────────────
 * La condition de recherche elle-même sert de garde d'« already done » —
 * une fois `sellerUsername` retiré du JSONB, une ré-exécution avec le même
 * identifiant ne retrouve plus la ligne, donc aucune double écriture,
 * aucune erreur.
 *
 * ── Aucune migration nécessaire pour cette implémentation ─────────────
 * Le retrait de clé JSONB est fait côté application (lecture, retrait,
 * écriture), pas via un opérateur SQL dédié. Une fonction Postgres serait
 * plus efficace à grande échelle — proposée mais **non appliquée** (ADR
 * 0011).
 */

export interface AccountDeletionIdentifiers {
  username?: string;
  userId?: string;
}

export interface AnonymizeResult {
  /**
   * `false` si la notification ne fournissait ni `username` ni `userId` —
   * aucune recherche n'a été déclenchée (rien à corréler). `true` dès
   * qu'une recherche a été tentée (que des annonces aient été trouvées ou
   * non) — voir la note de fichier sur la distinction.
   */
  correlationAttempted: boolean;
  listingsAnonymized: number;
}

interface ListingRow {
  id: string;
  raw_payload: Record<string, unknown> | null;
  seller_external_id: string | null;
}

export async function anonymizeEbaySellerData(
  supabase: SupabaseClient,
  identifiers: AccountDeletionIdentifiers,
): Promise<AnonymizeResult> {
  if (!identifiers.username && !identifiers.userId) {
    return { correlationAttempted: false, listingsAnonymized: 0 };
  }

  const matches = new Map<string, ListingRow>();

  if (identifiers.username) {
    const { data, error } = await supabase
      .from("listings")
      .select("id, raw_payload, seller_external_id")
      .eq("raw_payload->>sellerUsername", identifiers.username);
    if (error) {
      throw new Error(`Recherche des annonces par nom d'utilisateur eBay impossible : ${error.message}`);
    }
    for (const row of (data ?? []) as ListingRow[]) matches.set(row.id, row);
  }

  if (identifiers.userId) {
    const { data, error } = await supabase
      .from("listings")
      .select("id, raw_payload, seller_external_id")
      .eq("seller_external_id", identifiers.userId);
    if (error) {
      throw new Error(`Recherche des annonces par identifiant vendeur eBay impossible : ${error.message}`);
    }
    for (const row of (data ?? []) as ListingRow[]) matches.set(row.id, row);
  }

  let anonymized = 0;
  for (const [id, row] of matches) {
    const rawPayload = row.raw_payload ?? {};
    const hadUsername = Object.prototype.hasOwnProperty.call(rawPayload, "sellerUsername");
    const hadExternalId = row.seller_external_id !== null;
    if (!hadUsername && !hadExternalId) continue; // déjà anonymisé — aucune écriture, garantit l'idempotence.

    const { sellerUsername: _drop, ...rest } = rawPayload as Record<string, unknown> & { sellerUsername?: string };
    const { error: updateError } = await supabase
      .from("listings")
      .update({ raw_payload: rest, seller_external_id: null })
      .eq("id", id);
    if (updateError) {
      throw new Error(`Anonymisation de l'annonce ${id} impossible : ${updateError.message}`);
    }
    anonymized += 1;
  }

  return { correlationAttempted: true, listingsAnonymized: anonymized };
}
