import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { downloadImageSecurely, isPrivateOrReservedIp, ImagePolicyError } from "../download-image-securely";

const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x00, 0x00]);

function fakeRequestImpl(behavior: {
  status?: number;
  location?: string;
  bodyChunks?: Buffer[];
  simulateTimeout?: boolean;
  simulateError?: boolean;
}) {
  return vi.fn((_options: unknown, callback?: (res: unknown) => void) => {
    const req = new EventEmitter() as EventEmitter & { destroy: () => void; end: () => void };
    req.destroy = vi.fn();
    req.end = vi.fn(() => {
      if (behavior.simulateTimeout) {
        queueMicrotask(() => req.emit("timeout"));
        return;
      }
      if (behavior.simulateError) {
        queueMicrotask(() => req.emit("error", new Error("boom")));
        return;
      }
      queueMicrotask(() => {
        const res = new EventEmitter() as EventEmitter & { statusCode: number; headers: Record<string, string>; resume: () => void };
        res.statusCode = behavior.status ?? 200;
        res.headers = behavior.location ? { location: behavior.location } : {};
        res.resume = vi.fn();
        callback?.(res);
        queueMicrotask(() => {
          for (const chunk of behavior.bodyChunks ?? [JPEG_MAGIC]) res.emit("data", chunk);
          res.emit("end");
        });
      });
    });
    return req;
  });
}

describe("isPrivateOrReservedIp", () => {
  it("rejette loopback IPv4 et IPv6", () => {
    expect(isPrivateOrReservedIp("127.0.0.1")).toBe(true);
    expect(isPrivateOrReservedIp("::1")).toBe(true);
  });

  it("rejette les plages privées RFC1918", () => {
    expect(isPrivateOrReservedIp("10.0.0.5")).toBe(true);
    expect(isPrivateOrReservedIp("172.16.0.5")).toBe(true);
    expect(isPrivateOrReservedIp("192.168.1.5")).toBe(true);
  });

  it("rejette le endpoint metadata cloud (169.254.169.254) et le link-local", () => {
    expect(isPrivateOrReservedIp("169.254.169.254")).toBe(true);
    expect(isPrivateOrReservedIp("169.254.0.1")).toBe(true);
  });

  it("accepte une IP publique légitime", () => {
    expect(isPrivateOrReservedIp("93.184.216.34")).toBe(false);
  });
});

describe("downloadImageSecurely — protections SSRF", () => {
  it("rejette localhost via la résolution DNS", async () => {
    await expect(
      downloadImageSecurely("https://localhost/image.jpg", {
        dnsLookupImpl: async () => ({ address: "127.0.0.1" }),
        requestImpl: fakeRequestImpl({}) as never,
      }),
    ).rejects.toMatchObject({ code: "SSRF_BLOCKED" });
  });

  it("rejette une résolution vers 127.0.0.1", async () => {
    await expect(
      downloadImageSecurely("https://evil.example.com/image.jpg", {
        dnsLookupImpl: async () => ({ address: "127.0.0.1" }),
        requestImpl: fakeRequestImpl({}) as never,
      }),
    ).rejects.toMatchObject({ code: "SSRF_BLOCKED" });
  });

  it("rejette une résolution vers ::1", async () => {
    await expect(
      downloadImageSecurely("https://evil.example.com/image.jpg", {
        dnsLookupImpl: async () => ({ address: "::1" }),
        requestImpl: fakeRequestImpl({}) as never,
      }),
    ).rejects.toMatchObject({ code: "SSRF_BLOCKED" });
  });

  it("rejette une adresse privée (10.x)", async () => {
    await expect(
      downloadImageSecurely("https://internal.example.com/image.jpg", {
        dnsLookupImpl: async () => ({ address: "10.1.2.3" }),
        requestImpl: fakeRequestImpl({}) as never,
      }),
    ).rejects.toMatchObject({ code: "SSRF_BLOCKED" });
  });

  it("rejette le endpoint metadata cloud", async () => {
    await expect(
      downloadImageSecurely("https://metadata.example.com/image.jpg", {
        dnsLookupImpl: async () => ({ address: "169.254.169.254" }),
        requestImpl: fakeRequestImpl({}) as never,
      }),
    ).rejects.toMatchObject({ code: "SSRF_BLOCKED" });
  });

  it("rejette une redirection vers une IP privée", async () => {
    let call = 0;
    const requestImpl = vi.fn((_options: unknown, callback?: (res: unknown) => void) => {
      call += 1;
      const req = new EventEmitter() as EventEmitter & { destroy: () => void; end: () => void };
      req.destroy = vi.fn();
      req.end = vi.fn(() => {
        queueMicrotask(() => {
          const res = new EventEmitter() as EventEmitter & { statusCode: number; headers: Record<string, string>; resume: () => void };
          if (call === 1) {
            res.statusCode = 302;
            res.headers = { location: "https://internal.example.com/private.jpg" };
          } else {
            res.statusCode = 200;
            res.headers = {};
          }
          res.resume = vi.fn();
          callback?.(res);
          queueMicrotask(() => {
            res.emit("data", JPEG_MAGIC);
            res.emit("end");
          });
        });
      });
      return req;
    });

    await expect(
      downloadImageSecurely("https://public.example.com/image.jpg", {
        dnsLookupImpl: async (hostname: string) => ({
          address: hostname === "internal.example.com" ? "10.0.0.9" : "93.184.216.34",
        }),
        requestImpl: requestImpl as never,
      }),
    ).rejects.toMatchObject({ code: "SSRF_BLOCKED" });
  });

  it("rejette un fichier trop volumineux", async () => {
    const bigChunk = Buffer.alloc(1024, 1);
    await expect(
      downloadImageSecurely("https://public.example.com/image.jpg", {
        maxBytes: 512,
        dnsLookupImpl: async () => ({ address: "93.184.216.34" }),
        requestImpl: fakeRequestImpl({ bodyChunks: [bigChunk] }) as never,
      }),
    ).rejects.toMatchObject({ code: "TOO_LARGE" });
  });

  it("rejette un faux content-type (octets non-image malgré une réponse 200)", async () => {
    await expect(
      downloadImageSecurely("https://public.example.com/image.jpg", {
        dnsLookupImpl: async () => ({ address: "93.184.216.34" }),
        requestImpl: fakeRequestImpl({ bodyChunks: [Buffer.from("not an image at all")] }) as never,
      }),
    ).rejects.toMatchObject({ code: "INVALID_MIME" });
  });

  it("rejette après un timeout", async () => {
    await expect(
      downloadImageSecurely("https://public.example.com/image.jpg", {
        dnsLookupImpl: async () => ({ address: "93.184.216.34" }),
        requestImpl: fakeRequestImpl({ simulateTimeout: true }) as never,
      }),
    ).rejects.toMatchObject({ code: "TIMEOUT" });
  });

  it("accepte une image JPEG légitime servie par une IP publique", async () => {
    const result = await downloadImageSecurely("https://public.example.com/image.jpg", {
      dnsLookupImpl: async () => ({ address: "93.184.216.34" }),
      requestImpl: fakeRequestImpl({}) as never,
    });
    expect(result.mime).toBe("image/jpeg");
  });

  it("rejette une URL non-HTTPS avant toute résolution DNS", async () => {
    const lookup = vi.fn(async () => ({ address: "93.184.216.34" }));
    await expect(
      downloadImageSecurely("http://public.example.com/image.jpg", {
        dnsLookupImpl: lookup,
        requestImpl: fakeRequestImpl({}) as never,
      }),
    ).rejects.toBeInstanceOf(ImagePolicyError);
    expect(lookup).not.toHaveBeenCalled();
  });
});
