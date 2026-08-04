jest.mock("expo-constants", () => ({
  __esModule: true,
  default: { expoConfig: { extra: { supabaseUrl: "https://project.supabase.co" } } },
}));

const mockManipulateAsync = jest.fn();
jest.mock("expo-image-manipulator", () => ({
  manipulateAsync: (...args: unknown[]) => mockManipulateAsync(...args),
  SaveFormat: { JPEG: "jpeg" },
}));

const mockReadAsStringAsync = jest.fn();
jest.mock("expo-file-system", () => ({
  readAsStringAsync: (...args: unknown[]) => mockReadAsStringAsync(...args),
  EncodingType: { Base64: "base64" },
}));

const mockGetCurrentUserId = jest.fn();
jest.mock("../src/auth/session", () => ({
  getCurrentUserId: () => mockGetCurrentUserId(),
}));

const mockUpload = jest.fn();
const mockRemove = jest.fn();
jest.mock("../src/lib/supabase-client", () => ({
  supabase: {
    storage: {
      from: () => ({
        upload: (...args: unknown[]) => mockUpload(...args),
        remove: (...args: unknown[]) => mockRemove(...args),
      }),
    },
  },
}));

import { uploadTcgCardPhoto, deleteTcgCardPhoto, TcgUploadError } from "../src/api/tcg-upload-client";

/**
 * Vérifie le chemin d'upload réel (LOT 9, corrigé après un échec sur
 * appareil : "Network request failed") — lecture via `expo-file-system` +
 * décodage en `ArrayBuffer`, jamais `fetch(uri).blob()` (chemin non fiable
 * sur React Native, cause du bug initial).
 */
describe("uploadTcgCardPhoto", () => {
  beforeEach(() => {
    mockManipulateAsync.mockReset();
    mockReadAsStringAsync.mockReset();
    mockGetCurrentUserId.mockReset();
    mockUpload.mockReset();
    mockRemove.mockReset();
    mockManipulateAsync.mockResolvedValue({ uri: "file://resized.jpg" });
    mockGetCurrentUserId.mockResolvedValue("user-1");
  });

  it("lit le fichier redimensionné via expo-file-system (jamais fetch().blob()) et l'envoie en ArrayBuffer", async () => {
    mockReadAsStringAsync.mockResolvedValue(btoa("fake-jpeg-bytes"));
    mockUpload.mockResolvedValue({ error: null });

    const result = await uploadTcgCardPhoto("req-1", "file://original.jpg");

    expect(mockManipulateAsync).toHaveBeenCalledWith(
      "file://original.jpg",
      [{ resize: { width: 1600 } }],
      { compress: 0.9, format: "jpeg" },
    );
    expect(mockReadAsStringAsync).toHaveBeenCalledWith("file://resized.jpg", { encoding: "base64" });
    expect(mockUpload).toHaveBeenCalledTimes(1);
    const [path, payload, options] = mockUpload.mock.calls[0];
    expect(path).toBe("user-1/req-1/photo.jpg");
    expect(payload).toBeInstanceOf(ArrayBuffer);
    expect(options).toEqual({ contentType: "image/jpeg", upsert: false });
    expect(result.url).toContain("/analysis-uploads/user-1/req-1/photo.jpg");
  });

  it("aucune session active : refuse avant toute lecture de fichier ou upload", async () => {
    mockGetCurrentUserId.mockResolvedValue(null);

    await expect(uploadTcgCardPhoto("req-2", "file://original.jpg")).rejects.toThrow(TcgUploadError);
    expect(mockManipulateAsync).not.toHaveBeenCalled();
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it("échec Supabase Storage : erreur lisible, jamais une exception brute non gérée", async () => {
    mockReadAsStringAsync.mockResolvedValue(btoa("fake-jpeg-bytes"));
    mockUpload.mockResolvedValue({ error: { message: "Network request failed" } });

    await expect(uploadTcgCardPhoto("req-3", "file://original.jpg")).rejects.toThrow(/Network request failed/);
  });
});

describe("deleteTcgCardPhoto", () => {
  beforeEach(() => {
    mockGetCurrentUserId.mockReset();
    mockRemove.mockReset();
  });

  it("supprime le fichier au bon chemin", async () => {
    mockGetCurrentUserId.mockResolvedValue("user-1");
    mockRemove.mockResolvedValue({ error: null });

    await deleteTcgCardPhoto("req-4");

    expect(mockRemove).toHaveBeenCalledWith(["user-1/req-4/photo.jpg"]);
  });

  it("aucune session active : ne tente aucune suppression, jamais un crash", async () => {
    mockGetCurrentUserId.mockResolvedValue(null);

    await deleteTcgCardPhoto("req-5");

    expect(mockRemove).not.toHaveBeenCalled();
  });
});
