import { describe, expect, it } from "vitest";
import { fetchAllPages, fetchByIdChunks } from "./fetchAllPages";

describe("fetchAllPages", () => {
  it("loads more than the historical 10,000 row boundary", async () => {
    const source = Array.from({ length: 10507 }, (_, i) => i + 1);

    const result = await fetchAllPages<number>(
      async (from, to) => ({
        data: source.slice(from, to + 1),
        error: null,
      }),
      1000
    );

    expect(result).toHaveLength(10507);
    expect(result[0]).toBe(1);
    expect(result[10506]).toBe(10507);
  });

  it("handles an exact full final page", async () => {
    const source = Array.from({ length: 2000 }, (_, i) => i);

    const result = await fetchAllPages<number>(
      async (from, to) => ({
        data: source.slice(from, to + 1),
        error: null,
      }),
      1000
    );

    expect(result).toHaveLength(2000);
  });

  it("propagates page errors", async () => {
    await expect(
      fetchAllPages<number>(async () => ({
        data: null,
        error: { message: "page failed" },
      }))
    ).rejects.toThrow("page failed");
  });

  it("chunks large id sets without dropping rows", async () => {
    const ids = Array.from({ length: 505 }, (_, i) => `id-${i}`);

    const rows = await fetchByIdChunks<string>(
      ids,
      async (chunk, from, to) => ({
        data: chunk.slice(from, to + 1),
        error: null,
      }),
      200,
      1000
    );

    expect(rows).toHaveLength(505);
    expect(new Set(rows).size).toBe(505);
  });
});
