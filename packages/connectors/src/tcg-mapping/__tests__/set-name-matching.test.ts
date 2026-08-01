import { describe, expect, it } from "vitest";
import { setNamesMatch } from "../set-name-matching";

describe("setNamesMatch", () => {
  it('accepte "Base" ↔ "Base Set" (retrait du suffixe générique "set")', () => {
    const result = setNamesMatch("Base", "Base Set");
    expect(result.matched).toBe(true);
  });

  it('accepte "Scarlet & Violet" ↔ "Scarlet and Violet" (séparateur "&"/"and" unifié)', () => {
    const result = setNamesMatch("Scarlet & Violet", "Scarlet and Violet");
    expect(result.matched).toBe(true);
  });

  it('accepte "Team Rocket" ↔ "Team Rocket" (identiques après normalisation)', () => {
    const result = setNamesMatch("Team Rocket", "Team Rocket");
    expect(result.matched).toBe(true);
  });

  it('refuse "Base Set" ↔ "Base Set 2" (le suffixe générique ne se retire que s\'il est le dernier mot)', () => {
    const result = setNamesMatch("Base Set", "Base Set 2");
    expect(result.matched).toBe(false);
  });

  it('refuse "Neo Genesis" ↔ "Neo Discovery" (deux sets réels distincts, aucun mot en commun après le préfixe)', () => {
    const result = setNamesMatch("Neo Genesis", "Neo Discovery");
    expect(result.matched).toBe(false);
  });

  it("refuse deux noms proches mais distincts (ambigus pour un matching naïf par sous-chaîne) : jamais de contains() implicite", () => {
    // Deux sets réels distincts partageant la sous-chaîne "Team Rocket" — un
    // matching par contains()/préfixe les confondrait à tort, setNamesMatch
    // ne le fait jamais (aucun des trois mécanismes contrôlés ne s'applique).
    const result = setNamesMatch("EX Team Rocket Returns", "Team Rocket");
    expect(result.matched).toBe(false);
  });

  it("insensible à la casse, aux accents et à la ponctuation", () => {
    expect(setNamesMatch("BASE SET", "base set").matched).toBe(true);
    expect(setNamesMatch("Pokémon Center", "Pokemon Center").matched).toBe(true);
    expect(setNamesMatch("Team Rocket!", "Team Rocket").matched).toBe(true);
  });

  it("jamais de correspondance par préfixe ou sous-chaîne libre", () => {
    // "Fossil" ne doit jamais matcher "Fossil Vault" ou inversement : aucun
    // des trois mécanismes (normalisation seule / suffixe "set" / alias) ne
    // couvre ce cas, et c'est volontaire.
    expect(setNamesMatch("Fossil", "Fossil Vault").matched).toBe(false);
  });

  it("une comparaison d'un nom avec lui-même reste toujours acceptée, même après retrait de suffixe des deux côtés", () => {
    // Garde-fou : deux formes identiques ne doivent jamais être jugées
    // "ambiguës" simplement parce que plusieurs mécanismes s'appliqueraient
    // en parallèle — l'égalité normalisée est toujours vérifiée en premier.
    expect(setNamesMatch("Base Set", "Base Set").matched).toBe(true);
  });
});
