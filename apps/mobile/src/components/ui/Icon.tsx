// Import du sous-chemin `@expo/vector-icons/Ionicons` — PAS
// `import { Ionicons } from "@expo/vector-icons"` : ce dernier passe par
// `IconsLazy.js`, qui `require()` inconditionnellement les 18 AUTRES
// familles d'icônes du paquet au chargement (getters "lazy" côté accès à
// la propriété seulement, pas côté résolution Metro — vérifié via
// `expo export`, qui embarquait ~2,3 Mo de fontes AntDesign/Feather/
// FontAwesome*/MaterialIcons/etc. jamais utilisées avant ce correctif).
// Le sous-chemin n'embarque que la fonte Ionicons (~443 Ko) — c'est la
// seule famille dont ce fichier importe quoi que ce soit.
import Ionicons from "@expo/vector-icons/Ionicons";
import { colors } from "../../theme/tokens";

/**
 * Point d'accès UNIQUE aux icônes de l'app (LOT "visual product pass",
 * Phase 23 : "une seule famille d'icônes, élimine les emoji UI produit").
 * `@expo/vector-icons` est déjà une dépendance transitive d'`expo` lui-même
 * (présente dans le lockfile avant ce lot, aucune fonte native ajoutée,
 * aucune régénération de `android/` requise) — jamais importée directement
 * ailleurs que dans ce fichier, pour que changer de famille d'icônes plus
 * tard (ou brancher un vrai jeu d'icônes de marque) ne touche qu'un seul
 * endroit.
 *
 * Volontairement un sous-ensemble NOMMÉ (pas toute la surface Ionicons) —
 * chaque nom ci-dessous correspond à un usage réel dans l'app, jamais une
 * icône ajoutée "juste au cas où".
 *
 * Le fallback Raf (emoji dans `assets/raf/registry.ts`) N'EST PAS concerné
 * par cette règle (Phase 32 : "sauf fallback Raf explicitement prévu") —
 * ce fichier ne remplace que l'iconographie UI générique (navigation,
 * actions, statuts), jamais le personnage Raf.
 */
export type IconName =
  | "home"
  | "home-outline"
  | "time"
  | "time-outline"
  | "camera"
  | "camera-outline"
  | "star"
  | "star-outline"
  | "person"
  | "person-outline"
  | "heart"
  | "heart-outline"
  | "trash-outline"
  | "share-outline"
  | "checkmark-circle"
  | "alert-circle"
  | "close-circle"
  | "chevron-forward"
  | "chevron-back"
  | "images-outline"
  | "create-outline"
  | "settings-outline"
  | "information-circle-outline"
  | "shield-checkmark-outline"
  | "construct-outline"
  | "log-out-outline"
  | "close"
  | "refresh"
  | "ellipse"
  | "cube-outline"
  | "color-palette-outline"
  | "pulse-outline"
  | "chatbubble-outline"
  | "school-outline";

export interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
}

/** Icône simple — pas de conteneur, pas d'état pressé (voir `AppButton`/`ListRow` pour ça). */
export function Icon({ name, size = 20, color = colors.textPrimary }: IconProps) {
  return <Ionicons name={name} size={size} color={color} />;
}
