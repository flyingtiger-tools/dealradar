import { describe, it, expect } from "vitest";
import { parseArgs, refuseIfPolicyLocked } from "../source-smoke-test";

describe("parseArgs", () => {
  it("exige --source, --category, et au moins un --field", () => {
    expect(() => parseArgs([])).toThrow(/--source/);
    expect(() => parseArgs(["--source", "bricklink"])).toThrow(/--category/);
    expect(() => parseArgs(["--source", "bricklink", "--category", "lego"])).toThrow(/--field/);
  });

  it("parse les champs, la source, la catégorie, et --dry-run", () => {
    const args = parseArgs(["--source", "bricklink", "--category", "lego", "--field", "bricklinkNo=10300", "--dry-run"]);
    expect(args.source).toBe("bricklink");
    expect(args.categorySlug).toBe("lego");
    expect(args.fields.bricklinkNo).toBe("10300");
    expect(args.dryRun).toBe(true);
  });

  it("dry-run absent par défaut", () => {
    const args = parseArgs(["--source", "keepa", "--category", "apple", "--field", "asin=B0X"]);
    expect(args.dryRun).toBe(false);
  });

  it("plusieurs --field sont tous retenus", () => {
    const args = parseArgs(["--source", "ebay", "--category", "gaming", "--field", "brand=Nintendo", "--field", "model=Switch"]);
    expect(args.fields.brand).toBe("Nintendo");
    expect(args.fields.model).toBe("Switch");
  });
});

describe("refuseIfPolicyLocked", () => {
  it("refuse Ricardo (restricted) même sans vérifier de credentials", () => {
    expect(() => refuseIfPolicyLocked("ricardo")).toThrow(/restricted|verrouillée/);
  });

  it("refuse PriceCharting (license_required)", () => {
    expect(() => refuseIfPolicyLocked("pricecharting")).toThrow(/license_required|verrouillée/);
  });

  it("n'objecte pas pour une source non verrouillée par politique (ex. keepa, missing_credentials seul)", () => {
    expect(() => refuseIfPolicyLocked("keepa")).not.toThrow();
  });

  it("n'objecte pas pour une source hors matrice — laisse le chemin normal décider", () => {
    expect(() => refuseIfPolicyLocked("some_future_source")).not.toThrow();
  });
});
