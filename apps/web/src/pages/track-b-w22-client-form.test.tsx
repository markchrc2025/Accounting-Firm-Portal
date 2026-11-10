// W22: the client form's contact-number hint (Track A U22). Saving is never blocked by it:
// the API checks the number only where a return leaves the Portal. Invented data.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  fetchClients: vi.fn(() => Promise.resolve([])),
  fetchServices: vi.fn(() => Promise.resolve([])),
  createClient: vi.fn(),
}));
vi.mock("../lib/api", async (orig) => ({
  ...(await orig<typeof import("../lib/api")>()),
  ...api,
}));

import ClientFormPage from "./ClientFormPage";

function open() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={["/clients/new"]}>
        <Routes>
          <Route path="/clients/new" element={<ClientFormPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("W22 client form — contact number hint", () => {
  it("shows the hint under the phone field, word for word", () => {
    open();
    const hint = document.querySelector("[data-field-hint]");
    expect(hint?.textContent).toBe("Contact number: 11 digits, like 09171234567");
    // It sits with the Phone field, and the field is still named Phone.
    expect(hint?.closest("label")?.textContent).toContain("Phone");
    expect(screen.getByLabelText(/^Phone/)).toBeTruthy();
  });

  it("does not block typing a number of any shape", () => {
    open();
    const phone = screen.getByLabelText(/^Phone/) as HTMLInputElement;
    fireEvent.change(phone, { target: { value: "+63 917 123 4567" } });
    expect(phone.value).toBe("+63 917 123 4567");
    expect(document.querySelectorAll("[data-field-hint]")).toHaveLength(1);
  });
});
