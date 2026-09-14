const mockManipulateAsync = jest.fn();
jest.mock("expo-image-manipulator", () => ({
  manipulateAsync: (...args: unknown[]) => mockManipulateAsync(...args),
  SaveFormat: { JPEG: "jpeg" },
}));

import { normalizeOrientation, parseExifOrientation } from "../normalize-orientation";

describe("parseExifOrientation", () => {
  it("lit un Orientation numérique valide", () => {
    expect(parseExifOrientation({ Orientation: 6 })).toBe(6);
  });

  it("EXIF absent, null, ou de type inattendu : jamais une exception, toujours null", () => {
    expect(parseExifOrientation(undefined)).toBeNull();
    expect(parseExifOrientation(null)).toBeNull();
    expect(parseExifOrientation("not-an-object")).toBeNull();
    expect(parseExifOrientation({ Orientation: "6" })).toBeNull();
    expect(parseExifOrientation({})).toBeNull();
  });
});

describe("normalizeOrientation", () => {
  beforeEach(() => {
    mockManipulateAsync.mockReset();
  });

  it("portrait normal (EXIF 1) : aucun passage par manipulateAsync, image inchangée", async () => {
    const result = await normalizeOrientation({ uri: "file://a.jpg", width: 100, height: 200, exifOrientation: 1 });
    expect(mockManipulateAsync).not.toHaveBeenCalled();
    expect(result).toEqual({
      uri: "file://a.jpg",
      width: 100,
      height: 200,
      orientation: { exifOrientation: 1, pixelsPhysicallyRotated: true },
    });
  });

  it("EXIF absent (null) : aucun passage par manipulateAsync, pixelsPhysicallyRotated=false — rien à garantir", async () => {
    const result = await normalizeOrientation({ uri: "file://a.jpg", width: 100, height: 200, exifOrientation: null });
    expect(mockManipulateAsync).not.toHaveBeenCalled();
    expect(result.orientation).toEqual({ exifOrientation: null, pixelsPhysicallyRotated: false });
  });

  it("portrait avec EXIF 90° (orientation 6) : matérialise via manipulateAsync SANS action explicite (délègue au décodeur Glide déjà correcteur, évite la double rotation)", async () => {
    mockManipulateAsync.mockResolvedValue({ uri: "file://materialized.jpg", width: 100, height: 200 });
    const result = await normalizeOrientation({ uri: "file://a.jpg", width: 200, height: 100, exifOrientation: 6 });

    expect(mockManipulateAsync).toHaveBeenCalledWith("file://a.jpg", [], { format: "jpeg" });
    expect(result.orientation).toEqual({ exifOrientation: 6, pixelsPhysicallyRotated: true });
    expect(result.uri).toBe("file://materialized.jpg");
  });

  it("landscape (EXIF 3, 180°) : matérialise aussi sans action explicite", async () => {
    mockManipulateAsync.mockResolvedValue({ uri: "file://materialized.jpg", width: 200, height: 100 });
    await normalizeOrientation({ uri: "file://a.jpg", width: 200, height: 100, exifOrientation: 3 });
    expect(mockManipulateAsync).toHaveBeenCalledWith("file://a.jpg", [], { format: "jpeg" });
  });

  it("width/height inversés après matérialisation : le résultat reflète EXACTEMENT ce que manipulateAsync (Glide) renvoie, jamais recalculés nous-mêmes", async () => {
    // Le fichier source est reporté 200x100 (paysage) par la caméra, mais Glide corrige déjà
    // l'orientation EXIF au décodage : le fichier matérialisé peut ressortir 100x200 (portrait).
    // normalizeOrientation ne doit JAMAIS deviner/recalculer ces dimensions lui-même.
    mockManipulateAsync.mockResolvedValue({ uri: "file://materialized.jpg", width: 100, height: 200 });
    const result = await normalizeOrientation({ uri: "file://a.jpg", width: 200, height: 100, exifOrientation: 6 });
    expect(result.width).toBe(100);
    expect(result.height).toBe(200);
  });

  it("aucune double rotation : ne construit JAMAIS d'action rotate/flip, quelle que soit la valeur EXIF (1-8 ou hors plage) — la correction est entièrement déléguée au chargeur natif", async () => {
    mockManipulateAsync.mockResolvedValue({ uri: "file://materialized.jpg", width: 100, height: 200 });
    for (const exifOrientation of [2, 3, 4, 5, 6, 7, 8, 99]) {
      mockManipulateAsync.mockClear();
      await normalizeOrientation({ uri: "file://a.jpg", width: 100, height: 200, exifOrientation });
      expect(mockManipulateAsync).toHaveBeenCalledWith("file://a.jpg", [], { format: "jpeg" });
      // Vérifie explicitement qu'aucune action `rotate`/`flip` n'est jamais passée — c'est
      // exactement cette auto-correction redondante (en plus de celle de Glide) qui causait le
      // bug de double rotation observé sur Samsung S24 Ultra.
      const [, actions] = mockManipulateAsync.mock.calls[0] as [string, unknown[]];
      expect(actions).toEqual([]);
    }
  });
});
