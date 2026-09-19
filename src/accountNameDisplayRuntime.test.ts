// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

async function mountRuntime(markup: string) {
  vi.resetModules();
  document.body.innerHTML = markup;
  await import("./accountNameDisplayRuntime");
  document.dispatchEvent(new Event("DOMContentLoaded"));
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("account dropdown display isolation", () => {
  it("removes account codes without altering item and customer options in the same form", async () => {
    await mountRuntime(`
      <form>
        <label for="account-id">Account</label>
        <select id="account-id"><option value="a">1120 Bank Al Habib</option></select>
        <label for="item-id">Item</label>
        <select id="item-id"><option value="i">40 Foot Girder</option></select>
        <label for="customer-id">Customer</label>
        <select id="customer-id"><option value="c">2026 Trading Company</option></select>
      </form>
    `);
    expect(document.querySelector<HTMLSelectElement>("#account-id")?.options[0].textContent).toBe("Bank Al Habib");
    expect(document.querySelector<HTMLSelectElement>("#item-id")?.options[0].textContent).toBe("40 Foot Girder");
    expect(document.querySelector<HTMLSelectElement>("#customer-id")?.options[0].textContent).toBe("2026 Trading Company");
    expect(document.querySelector<HTMLSelectElement>("#account-id")?.options[0].dataset.naviloAccountLabel).toBe("1120 Bank Al Habib");
  });

  it("normalizes a newly inserted option in an explicitly named account selector", async () => {
    await mountRuntime(`<select name="ledgerAccount"><option value="a">1120 - Bank</option></select>`);
    const select = document.querySelector<HTMLSelectElement>("select")!;
    const option = document.createElement("option");
    option.value = "b";
    option.textContent = "1130 Cash";
    select.append(option);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(select.options[0].textContent).toBe("Bank");
    expect(select.options[1].textContent).toBe("Cash");
  });

  it("preserves UUID-backed numeric item and customer names", async () => {
    await mountRuntime(`
      <label for="items">Item</label>
      <select id="items">
        <option value="123e4567-e89b-12d3-a456-426614174000">40 Foot Girder</option>
        <option value="123e4567-e89b-12d3-a456-426614174001">60 Foot Girder</option>
      </select>
      <label for="customers">Customer</label>
      <select id="customers">
        <option value="123e4567-e89b-12d3-a456-426614174002">2026 Trading Company</option>
        <option value="123e4567-e89b-12d3-a456-426614174003">2027 Trading Company</option>
      </select>
    `);
    expect(Array.from(document.querySelector<HTMLSelectElement>("#items")!.options, (option) => option.textContent)).toEqual(["40 Foot Girder", "60 Foot Girder"]);
    expect(Array.from(document.querySelector<HTMLSelectElement>("#customers")!.options, (option) => option.textContent)).toEqual(["2026 Trading Company", "2027 Trading Company"]);
  });
});
