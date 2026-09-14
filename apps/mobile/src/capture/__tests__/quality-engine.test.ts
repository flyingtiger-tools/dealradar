import {
  evaluateQuality,
  parseExifExposureTime,
  parseExifIsoSpeed,
  possibleRotationWarning,
} from "../quality-engine";
import type { QualitySignals } from "../types";

function baseSignals(overrides: Partial<QualitySignals> = {}): QualitySignals {
  return {
    originalWidth: 3000,
    originalHeight: 4000,
    fileSizeBytes: 2_000_000,
    exposureTimeSeconds: null,
    isoSpeed: null,
    assumedRegionCropWidth: 1200,
    assumedRegionCropHeight: 1600,
    ...overrides,
  };
}

describe("evaluateQuality — résolution", () => {
  it("résolution insuffisante : avertissement explicite", () => {
    const warnings = evaluateQuality(baseSignals({ originalWidth: 800, originalHeight: 600 }));
    expect(warnings).toContain("LOW_RESOLUTION");
  });

  it("résolution suffisante : aucun avertissement de résolution", () => {
    const warnings = evaluateQuality(baseSignals());
    expect(warnings).not.toContain("LOW_RESOLUTION");
  });
});

describe("evaluateQuality — flou et luminosité (heuristiques EXIF)", () => {
  it("temps de pose long : POSSIBLE_BLUR", () => {
    const warnings = evaluateQuality(baseSignals({ exposureTimeSeconds: 1 / 8 }));
    expect(warnings).toContain("POSSIBLE_BLUR");
  });

  it("temps de pose court : jamais POSSIBLE_BLUR", () => {
    const warnings = evaluateQuality(baseSignals({ exposureTimeSeconds: 1 / 250 }));
    expect(warnings).not.toContain("POSSIBLE_BLUR");
  });

  it("ISO élevé : LOW_LIGHT", () => {
    const warnings = evaluateQuality(baseSignals({ isoSpeed: 3200 }));
    expect(warnings).toContain("LOW_LIGHT");
  });

  it("ISO bas : jamais LOW_LIGHT", () => {
    const warnings = evaluateQuality(baseSignals({ isoSpeed: 100 }));
    expect(warnings).not.toContain("LOW_LIGHT");
  });

  it("EXIF absent (null) : jamais un avertissement inventé", () => {
    const warnings = evaluateQuality(baseSignals({ exposureTimeSeconds: null, isoSpeed: null }));
    expect(warnings).not.toContain("POSSIBLE_BLUR");
    expect(warnings).not.toContain("LOW_LIGHT");
  });
});

describe("evaluateQuality — objet trop petit dans le cadre", () => {
  it("crop de la région assumée trop petit : avertissement explicite", () => {
    const warnings = evaluateQuality(baseSignals({ assumedRegionCropWidth: 300, assumedRegionCropHeight: 400 }));
    expect(warnings).toContain("OBJECT_TOO_SMALL_IN_FRAME");
  });

  it("crop suffisant : aucun avertissement", () => {
    const warnings = evaluateQuality(baseSignals({ assumedRegionCropWidth: 1200, assumedRegionCropHeight: 1600 }));
    expect(warnings).not.toContain("OBJECT_TOO_SMALL_IN_FRAME");
  });

  it("région absente (null) : jamais un avertissement inventé sans donnée", () => {
    const warnings = evaluateQuality(baseSignals({ assumedRegionCropWidth: null, assumedRegionCropHeight: null }));
    expect(warnings).not.toContain("OBJECT_TOO_SMALL_IN_FRAME");
  });
});

describe("possibleRotationWarning", () => {
  // Signature changée (Samsung S24 Ultra, correctif double-rotation) : dépend maintenant du
  // résultat RÉEL de la normalisation (`pixelsPhysicallyRotated`), pas du tag EXIF brut — voir
  // normalize-orientation.ts. Se baser sur le tag EXIF brut déclenchait ce warning même quand
  // l'image AVAIT été correctement corrigée (faux positif systématique en usage normal).
  it("orientation non garantie (pixelsPhysicallyRotated=false, EXIF absent) : POSSIBLE_ROTATION", () => {
    expect(possibleRotationWarning(false)).toEqual(["POSSIBLE_ROTATION"]);
  });

  it("orientation corrigée ou déjà correcte (pixelsPhysicallyRotated=true) : aucun avertissement", () => {
    expect(possibleRotationWarning(true)).toEqual([]);
  });
});

describe("parseExifExposureTime / parseExifIsoSpeed", () => {
  it("lit des valeurs numériques valides", () => {
    expect(parseExifExposureTime({ ExposureTime: 0.02 })).toBe(0.02);
    expect(parseExifIsoSpeed({ ISOSpeedRatings: 400 })).toBe(400);
  });

  it("ISOSpeedRatings en tableau (variation de plateforme) : prend la première valeur", () => {
    expect(parseExifIsoSpeed({ ISOSpeedRatings: [800] })).toBe(800);
  });

  it("EXIF absent, mal formé, ou valeur non numérique : jamais une exception, toujours null", () => {
    expect(parseExifExposureTime(undefined)).toBeNull();
    expect(parseExifExposureTime({})).toBeNull();
    expect(parseExifExposureTime({ ExposureTime: "fast" })).toBeNull();
    expect(parseExifIsoSpeed(null)).toBeNull();
    expect(parseExifIsoSpeed({ ISOSpeedRatings: [] })).toBeNull();
  });
});
