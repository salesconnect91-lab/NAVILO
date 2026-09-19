// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, waitFor, cleanup } from "@testing-library/react";
import { createElement } from "react";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        maybeSingle: async () => ({
          data: {
            screen_language_mode: "single",
            screen_primary_language: "ur",
            screen_secondary_language: null,
            document_language_mode: "single",
            document_primary_language: "en",
            document_secondary_language: null,
          },
          error: null,
        }),
      }),
    }),
    auth: { getUser: async () => ({ data: { user: null }, error: null }) },
  },
}));

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("global screen translation and print isolation", () => {
  it("translates screen labels without changing print labels or attributes", async () => {
    document.body.innerHTML = `
      <button id="screen-label">Posted</button>
      <div class="print-document">
        <button id="print-label" title="Posted" aria-label="Posted">Posted</button>
      </div>
    `;

    const { default: GlobalLanguageRuntime } = await import("./GlobalLanguageRuntime");
    render(createElement(GlobalLanguageRuntime));

    await waitFor(() => {
      expect(document.querySelector("#screen-label")?.textContent).toBe("پوسٹ شدہ");
    });

    const printLabel = document.querySelector("#print-label");
    expect(printLabel?.textContent).toBe("Posted");
    expect(printLabel?.getAttribute("title")).toBe("Posted");
    expect(printLabel?.getAttribute("aria-label")).toBe("Posted");
  });
});
