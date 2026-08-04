const mockManipulateAsync = jest.fn();
jest.mock("expo-image-manipulator", () => ({
  manipulateAsync: (...args: unknown[]) => mockManipulateAsync(...args),
  SaveFormat: { JPEG: "jpeg" },
  FlipType: { Vertical: "vertical", Horizontal: "horizontal" },
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

  it("orientation 1 (standard) : aucune manipulation, pixelsPhysicallyRotated=true (déjà correcte)", async () => {
    const result = await normalizeOrientation({ uri: "file://a.jpg", width: 100, height: 200, exifOrientation: 1 });
    expect(mockManipulateAsync).not.toHaveBeenCalled();
    expect(result.orientation).toEqual({ exifOrientation: 1, pixelsPhysicallyRotated: true });
    expect(result.uri).toBe("file://a.jpg");
  });

  it("EXIF absent (null) : aucune manipulation, pixelsPhysicallyRotated=false — jamais une supposition", async () => {
    const result = await normalizeOrientation({ uri: "file://a.jpg", width: 100, height: 200, exifOrientation: null });
    expect(mockManipulateAsync).not.toHaveBeenCalled();
    expect(result.orientation).toEqual({ exifOrientation: null, pixelsPhysicallyRotated: false });
  });

  it("orientation 6 (rotation 90°) : applique une rotation réelle des pixels", async () => {
    mockManipulateAsync.mockResolvedValue({ uri: "file://rotated.jpg", width: 200, height: 100 });
    const result = await normalizeOrientation({ uri: "file://a.jpg", width: 100, height: 200, exifOrientation: 6 });

    expect(mockManipulateAsync).toHaveBeenCalledWith("file://a.jpg", [{ rotate: 90 }], { format: "jpeg" });
    expect(result.orientation).toEqual({ exifOrientation: 6, pixelsPhysicallyRotated: true });
    expect(result.uri).toBe("file://rotated.jpg");
    expect(result.width).toBe(200);
  });

  it("orientation 3 (180°) : applique une rotation de 180°", async () => {
    mockManipulateAsync.mockResolvedValue({ uri: "file://rotated.jpg", width: 100, height: 200 });
    await normalizeOrientation({ uri: "file://a.jpg", width: 100, height: 200, exifOrientation: 3 });
    expect(mockManipulateAsync).toHaveBeenCalledWith("file://a.jpg", [{ rotate: 180 }], { format: "jpeg" });
  });

  it("orientation 8 (rotation -90°/270°) : applique la rotation correcte", async () => {
    mockManipulateAsync.mockResolvedValue({ uri: "file://rotated.jpg", width: 200, height: 100 });
    await normalizeOrientation({ uri: "file://a.jpg", width: 100, height: 200, exifOrientation: 8 });
    expect(mockManipulateAsync).toHaveBeenCalledWith("file://a.jpg", [{ rotate: 270 }], { format: "jpeg" });
  });

  it("orientation miroir (2) : applique un flip horizontal, jamais une rotation seule", async () => {
    mockManipulateAsync.mockResolvedValue({ uri: "file://flipped.jpg", width: 100, height: 200 });
    await normalizeOrientation({ uri: "file://a.jpg", width: 100, height: 200, exifOrientation: 2 });
    expect(mockManipulateAsync).toHaveBeenCalledWith("file://a.jpg", [{ flip: "horizontal" }], { format: "jpeg" });
  });

  it("valeur EXIF hors 1-8 : jamais devinée, image laissée telle quelle", async () => {
    const result = await normalizeOrientation({ uri: "file://a.jpg", width: 100, height: 200, exifOrientation: 99 });
    expect(mockManipulateAsync).not.toHaveBeenCalled();
    expect(result.orientation).toEqual({ exifOrientation: 99, pixelsPhysicallyRotated: false });
  });
});
