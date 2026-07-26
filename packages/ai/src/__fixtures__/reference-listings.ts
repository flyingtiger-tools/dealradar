/**
 * Jeu de référence synthétique — aucune donnée personnelle, aucune annonce
 * réelle. Utilisé pour mesurer la précision d'identification déterministe
 * (rapporté dans le rapport final du Lot 5), pas pour entraîner quoi que ce
 * soit (aucun entraînement ML dans ce lot).
 */
export interface ReferenceListing {
  categorySlug: string;
  title: string;
  description?: string;
  /** Vrai si l'extraction déterministe seule doit suffire à l'identification (annoté à la main). */
  expectSufficientDeterministic: boolean;
}

export const REFERENCE_LISTINGS: ReferenceListing[] = [
  // LEGO
  { categorySlug: "lego", title: "LEGO Star Wars 75313 AT-AT", expectSufficientDeterministic: true },
  { categorySlug: "lego", title: "LEGO Technic 42115 Lamborghini Sian", expectSufficientDeterministic: true },
  { categorySlug: "lego", title: "LEGO Creator Expert 10294 Titanic", expectSufficientDeterministic: true },
  { categorySlug: "lego", title: "LEGO City 60292 Le centre-ville", expectSufficientDeterministic: true },
  { categorySlug: "lego", title: "LEGO Harry Potter 71043 Château de Poudlard", expectSufficientDeterministic: true },
  { categorySlug: "lego", title: "LEGO Ninjago 71741 Le temple ninja", expectSufficientDeterministic: true },
  { categorySlug: "lego", title: "LEGO Friends 41715 La maison de l'arbre", expectSufficientDeterministic: true },
  { categorySlug: "lego", title: "LEGO Icons 10276 Colisée", expectSufficientDeterministic: true },
  { categorySlug: "lego", title: "Grand lot de pièces LEGO en vrac", expectSufficientDeterministic: false },
  { categorySlug: "lego", title: "LEGO Star Wars véhicule vintage rare collector", expectSufficientDeterministic: false },
  { categorySlug: "lego", title: "Boîte de LEGO Duplo pour bébé, très bon état", expectSufficientDeterministic: false },

  // Apple
  { categorySlug: "apple", title: "Apple iPhone 13 Pro Max 256GB", expectSufficientDeterministic: true },
  { categorySlug: "apple", title: "Apple MacBook Air M2 512Go", expectSufficientDeterministic: true },
  { categorySlug: "apple", title: "Apple iPad Pro 128GB", expectSufficientDeterministic: true },
  { categorySlug: "apple", title: "Apple iPhone 15 256 Go comme neuf", expectSufficientDeterministic: true },
  { categorySlug: "apple", title: "Apple MacBook Pro 1TB", expectSufficientDeterministic: true },
  { categorySlug: "apple", title: "Apple iMac 256Go bon état", expectSufficientDeterministic: true },
  { categorySlug: "apple", title: "Apple AirPods Pro 64GB", expectSufficientDeterministic: true },
  { categorySlug: "apple", title: "Apple iPad mini 64Go état correct", expectSufficientDeterministic: true },
  { categorySlug: "apple", title: "iPhone ancien modèle, état à voir", expectSufficientDeterministic: false },
  { categorySlug: "apple", title: "Accessoire de charge compatible Apple", expectSufficientDeterministic: false },

  // Pokémon / TCG
  { categorySlug: "pokemon_tcg", title: "Pokémon Dracaufeu VMAX 020/189", expectSufficientDeterministic: true },
  { categorySlug: "pokemon_tcg", title: "Pokémon Pikachu Illustrator 001/001", expectSufficientDeterministic: true },
  { categorySlug: "pokemon_tcg", title: "Pokémon Mewtwo GX 039/147", expectSufficientDeterministic: true },
  { categorySlug: "pokemon_tcg", title: "Carte Pokémon Rayquaza VMAX 111/203", expectSufficientDeterministic: true },
  { categorySlug: "pokemon_tcg", title: "Pokémon Lugia Legend 106/113", expectSufficientDeterministic: true },
  { categorySlug: "pokemon_tcg", title: "Pokémon Sylveon VMAX 076/203", expectSufficientDeterministic: true },
  { categorySlug: "pokemon_tcg", title: "Pokémon Umbreon Gold Star 17/17", expectSufficientDeterministic: true },
  { categorySlug: "pokemon_tcg", title: "Pokémon Célébi ex 006/165", expectSufficientDeterministic: true },
  { categorySlug: "pokemon_tcg", title: "Lot de cartes Pokémon vrac dépareillées", expectSufficientDeterministic: false },
  { categorySlug: "pokemon_tcg", title: "Belle carte Pokémon rare à identifier", expectSufficientDeterministic: false },

  // Gaming
  { categorySlug: "gaming", title: "PS5 God of War Ragnarök", expectSufficientDeterministic: true },
  { categorySlug: "gaming", title: "Nintendo Switch The Legend of Zelda Tears of the Kingdom", expectSufficientDeterministic: true },
  { categorySlug: "gaming", title: "Xbox Series X Forza Horizon 5", expectSufficientDeterministic: true },
  { categorySlug: "gaming", title: "PS4 Marvel's Spider-Man", expectSufficientDeterministic: true },
  { categorySlug: "gaming", title: "Nintendo Switch OLED Mario Kart 8 Deluxe", expectSufficientDeterministic: true },
  { categorySlug: "gaming", title: "Wii U Super Mario 3D World", expectSufficientDeterministic: true },
  { categorySlug: "gaming", title: "PS Vita Persona 4 Golden", expectSufficientDeterministic: true },
  { categorySlug: "gaming", title: "GameCube Metroid Prime", expectSufficientDeterministic: true },
  { categorySlug: "gaming", title: "Jeu vidéo occasion complet", expectSufficientDeterministic: false },
  { categorySlug: "gaming", title: "Console de jeu rétro à identifier", expectSufficientDeterministic: false },

  // Photo
  { categorySlug: "photo", title: "Canon EOS R6", expectSufficientDeterministic: true },
  { categorySlug: "photo", title: "Nikon D850 boîtier nu", expectSufficientDeterministic: true },
  { categorySlug: "photo", title: "Sony A7 III", expectSufficientDeterministic: true },
  { categorySlug: "photo", title: "Fujifilm X-T4 très bon état", expectSufficientDeterministic: true },
  { categorySlug: "photo", title: "Olympus OM-D E-M10", expectSufficientDeterministic: true },
  { categorySlug: "photo", title: "Panasonic Lumix GH5", expectSufficientDeterministic: true },
  { categorySlug: "photo", title: "Leica Q2 comme neuf", expectSufficientDeterministic: true },
  { categorySlug: "photo", title: "Canon objectif 50mm f/1.8", expectSufficientDeterministic: true },
  { categorySlug: "photo", title: "Vieil appareil photo argentique de collection", expectSufficientDeterministic: false },
  { categorySlug: "photo", title: "Sacoche photo compatible plusieurs marques", expectSufficientDeterministic: false },
];
