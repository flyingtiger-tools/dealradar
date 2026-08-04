const mockManipulateAsync = jest.fn();
jest.mock("expo-image-manipulator", () => ({
  manipulateAsync: (...args: unknown[]) => mockManipulateAsync(...args),
  SaveFormat: { JPEG: "jpeg" },
}));

import { computeAssumedRegionRect, generateGuideFrameCrop } from "../generate-crops";

describe("computeAssumedRegionRect", () => {
  beforeEach(() => {
    mockManipulateAsync.mockReset();
  });

  it("centre le cadre proportionnellement en orientation paysage", () => {
    const rect = computeAssumedRegionRect(4000, 3000, 0.75, 0.6);
    expect(rect.width).toBe(2400); // 4000 * 0.6
    // hauteur théorique = round(2400 / 0.75) = 3200, plafonnée à la hauteur de l'image (3000)
    expect(rect.height).toBe(3000);
    expect(rect.originX).toBe(Math.round((4000 - rect.width) / 2));
    expect(rect.originY).toBe(Math.round((3000 - rect.height) / 2));
  });

  it("centre le cadre proportionnellement en orientation portrait (dimensions inversées)", () => {
    const rect = computeAssumedRegionRect(3000, 4000, 0.75, 0.6);
    expect(rect.width).toBe(1800); // 3000 * 0.6
    expect(rect.originX).toBe(Math.round((3000 - rect.width) / 2));
    expect(rect.originY).toBe(Math.round((4000 - rect.height) / 2));
  });

  it("plafonne la hauteur du cadre à la hauteur de l'image — jamais un rectangle hors image", () => {
    const rect = computeAssumedRegionRect(1000, 500, 0.1, 0.9); // ratio très étroit → hauteur théorique énorme
    expect(rect.height).toBeLessThanOrEqual(500);
    expect(rect.originY).toBeGreaterThanOrEqual(0);
  });

  it("plafonne la fraction de largeur à [0.01, 1] — jamais une valeur aberrante fournie par un appelant", () => {
    const rect = computeAssumedRegionRect(1000, 1000, 1, 5);
    expect(rect.width).toBeLessThanOrEqual(1000);
  });
});

describe("generateGuideFrameCrop", () => {
  beforeEach(() => {
    mockManipulateAsync.mockReset();
  });

  it("génère le crop depuis l'URI ORIGINALE fournie, jamais une autre", async () => {
    mockManipulateAsync.mockResolvedValue({ uri: "file://cropped.jpg", width: 600, height: 800 });
    const rect = { originX: 10, originY: 20, width: 600, height: 800 };

    const region = await generateGuideFrameCrop("file://original-full-res.jpg", rect);

    expect(mockManipulateAsync).toHaveBeenCalledWith(
      "file://original-full-res.jpg",
      [{ crop: { originX: 10, originY: 20, width: 600, height: 800 } }],
      { format: "jpeg" },
    );
    expect(region.kind).toBe("guide_frame_assumed");
    expect(region.crop).toEqual({ uri: "file://cropped.jpg", width: 600, height: 800 });
  });

  it("les coins retournés correspondent exactement au rectangle demandé", async () => {
    mockManipulateAsync.mockResolvedValue({ uri: "file://cropped.jpg", width: 100, height: 100 });
    const rect = { originX: 5, originY: 5, width: 100, height: 100 };

    const region = await generateGuideFrameCrop("file://x.jpg", rect);

    expect(region.corners).toEqual([
      { x: 5, y: 5 },
      { x: 105, y: 5 },
      { x: 105, y: 105 },
      { x: 5, y: 105 },
    ]);
  });
});
