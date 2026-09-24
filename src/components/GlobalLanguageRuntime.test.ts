// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, waitFor, cleanup } from "@testing-library/react";
import { createElement } from "react";

const mockCompany = vi.hoisted(() => ({
  data: {
    screen_language_mode: "single",
    screen_primary_language: "ur",
    screen_secondary_language: null,
    document_language_mode: "single",
    document_primary_language: "en",
    document_secondary_language: null,
  },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => ({
      select: () => ({
        maybeSingle: async () => ({ data: table === "company_settings" ? mockCompany.data : null, error: null }),
        eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
      }),
    }),
    auth: { getUser: async () => ({ data: { user: { id: "test-user" } }, error: null }) },
  },
}));

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  mockCompany.data.screen_language_mode = "single";
  mockCompany.data.screen_primary_language = "ur";
  mockCompany.data.screen_secondary_language = null;
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

  it("removes hard-coded Urdu from English-only UI labels", async () => {
    mockCompany.data.screen_language_mode = "single";
    mockCompany.data.screen_primary_language = "en";
    document.body.innerHTML = `<h1>Company Settings / کمپنی سیٹنگز</h1><button>Save / محفوظ کریں</button>`;

    const { default: GlobalLanguageRuntime } = await import("./GlobalLanguageRuntime");
    render(createElement(GlobalLanguageRuntime));

    await waitFor(() => {
      expect(document.querySelector("h1")?.textContent).toBe("Company Settings");
      expect(document.querySelector("button")?.textContent).toBe("Save");
    });
  });

  it("rebuilds hard-coded bilingual UI labels from the selected language pair", async () => {
    mockCompany.data.screen_language_mode = "bilingual";
    mockCompany.data.screen_primary_language = "en";
    mockCompany.data.screen_secondary_language = "ur";
    document.body.innerHTML = `<h1>Company Settings / کمپنی سیٹنگز</h1>`;

    const { default: GlobalLanguageRuntime } = await import("./GlobalLanguageRuntime");
    render(createElement(GlobalLanguageRuntime));

    await waitFor(() => {
      expect(document.querySelector("h1")?.textContent).toBe("Company Settings / کمپنی سیٹنگز");
    });
  });
});
