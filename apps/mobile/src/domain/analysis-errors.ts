/**
 * Taxonomie d'erreur consommateur (LOT "beta product readiness", Phase 8/9)
 * — SOURCE UNIQUE. Toute couche (client API, mapping de résultat, écran)
 * qui doit choisir un titre/message/action pour une situation d'échec ou
 * de résultat partiel importe `mapAnalysisErrorToUserMessage` d'ici,
 * jamais un second switch local (voir l'ancien `ErrorState.tsx`, qui
 * déléguait déjà à un `resolveErrorCopy` interne — remplacé par cette
 * fonction, formes équivalentes, jamais deux définitions concurrentes).
 *
 * Deux familles bien distinctes de situations produisent un
 * `AnalysisErrorCode`, jamais mélangées :
 *
 * 1. Échecs de TRANSPORT/REQUÊTE (jamais un résultat) : `NETWORK_UNAVAILABLE`,
 *    `REQUEST_TIMEOUT`, `UPLOAD_FAILED`, `BACKEND_UNAVAILABLE`,
 *    `AUTH_REQUIRED`, `INVALID_ANALYSIS_RESPONSE`, `UNKNOWN_ERROR` — levés
 *    comme `TcgAnalyzeError` par `api/tcg-analyze-client.ts`, jamais
 *    ajoutés à l'historique (voir `history/`).
 * 2. Statuts de CONTENU d'un résultat par ailleurs réussi (HTTP 200) :
 *    `PROVIDER_UNAVAILABLE`, `NO_MATCH`, `LOW_CONFIDENCE`, `NO_PRICE` —
 *    dérivés par `screens/result/result-view-model.ts` à partir du corps
 *    de la réponse, jamais une exception, et **historisables** (une carte
 *    identifiée sans prix reste un résultat utile — Phase 13/19 du lot
 *    précédent, Phase 13/14 de ce lot).
 */

export type AnalysisErrorCode =
  | "NETWORK_UNAVAILABLE"
  | "REQUEST_TIMEOUT"
  | "UPLOAD_FAILED"
  | "BACKEND_UNAVAILABLE"
  | "PROVIDER_UNAVAILABLE"
  | "INVALID_ANALYSIS_RESPONSE"
  | "LOW_CONFIDENCE"
  | "NO_MATCH"
  | "NO_PRICE"
  | "AUTH_REQUIRED"
  | "UNKNOWN_ERROR";

export interface AnalysisErrorInfo {
  code: AnalysisErrorCode;
  title: string;
  message: string;
  /** `true` si un nouveau essai a une chance réelle de réussir (jamais vrai pour une cause qui ne changera pas seule, ex. AUTH_REQUIRED sans reconnexion). */
  retryable: boolean;
  /** Action suggérée à afficher à l'utilisateur — `null` si "réessayer" seul suffit. */
  suggestedAction: string | null;
}

const ANALYSIS_ERROR_INFO: Record<AnalysisErrorCode, AnalysisErrorInfo> = {
  NETWORK_UNAVAILABLE: {
    code: "NETWORK_UNAVAILABLE",
    title: "Pas de connexion",
    message: "Connexion nécessaire pour analyser le marché.",
    retryable: true,
    suggestedAction: "Vérifie ta connexion puis réessaie.",
  },
  REQUEST_TIMEOUT: {
    code: "REQUEST_TIMEOUT",
    title: "Analyse trop longue",
    message: "Le serveur a mis trop de temps à répondre.",
    retryable: true,
    suggestedAction: null,
  },
  UPLOAD_FAILED: {
    code: "UPLOAD_FAILED",
    title: "Envoi impossible",
    message: "La photo n'a pas pu être envoyée.",
    retryable: true,
    suggestedAction: "Réessaie — ou reprends une photo plus légère.",
  },
  BACKEND_UNAVAILABLE: {
    code: "BACKEND_UNAVAILABLE",
    title: "Service indisponible",
    message: "Le service est momentanément indisponible.",
    retryable: true,
    suggestedAction: "Réessaie dans un instant.",
  },
  PROVIDER_UNAVAILABLE: {
    code: "PROVIDER_UNAVAILABLE",
    title: "Identification automatique indisponible",
    message: "L'identification automatique n'est pas disponible pour le moment.",
    retryable: false,
    suggestedAction: "Tu peux renseigner les informations de la carte manuellement.",
  },
  INVALID_ANALYSIS_RESPONSE: {
    code: "INVALID_ANALYSIS_RESPONSE",
    title: "Réponse illisible",
    message: "Impossible de lire le résultat de l'analyse.",
    retryable: true,
    suggestedAction: null,
  },
  LOW_CONFIDENCE: {
    code: "LOW_CONFIDENCE",
    title: "Identification incertaine",
    message: "Raf n'est pas sûr de cette identification.",
    retryable: true,
    suggestedAction: "Vérifie le résultat ou reprends la photo.",
  },
  NO_MATCH: {
    code: "NO_MATCH",
    title: "Carte non identifiée",
    message: "Impossible d'identifier cette carte avec la photo fournie.",
    retryable: true,
    suggestedAction: "Réessaie avec une photo plus nette, ou renseigne les informations manuellement.",
  },
  NO_PRICE: {
    // Volontairement le même ton qu'une identité réussie — jamais présenté
    // comme un échec (Phase 8 : "NO_PRICE n'est PAS forcément une erreur").
    code: "NO_PRICE",
    title: "Carte identifiée",
    message: "Prix temporairement indisponible pour cette carte.",
    retryable: false,
    suggestedAction: null,
  },
  AUTH_REQUIRED: {
    code: "AUTH_REQUIRED",
    title: "Connexion nécessaire",
    message: "Reconnecte-toi pour continuer.",
    retryable: false,
    suggestedAction: "Déconnecte-toi puis reconnecte-toi.",
  },
  UNKNOWN_ERROR: {
    code: "UNKNOWN_ERROR",
    title: "Un problème est survenu",
    message: "Une erreur est survenue — réessaie dans un instant.",
    retryable: true,
    suggestedAction: null,
  },
};

/** Fonction UNIQUE (Phase 9 : "pas 15 switchs différents") — code -> {title, message, retryable, suggestedAction}. */
export function mapAnalysisErrorToUserMessage(code: AnalysisErrorCode): AnalysisErrorInfo {
  return ANALYSIS_ERROR_INFO[code];
}
