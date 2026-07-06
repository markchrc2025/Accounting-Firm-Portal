import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { OAUTH_SCOPES, VatClass } from "@portal/shared";
import { describe, expect, it, vi } from "vitest";
import App from "./App";

// Health fetch is not the subject here — stub it so the query settles.
vi.mock("./lib/api", () => ({
  fetchHealth: vi.fn().mockRejectedValue(new Error("offline")),
}));

function renderApp() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>,
  );
}

describe("App", () => {
  it("renders the title", () => {
    renderApp();
    expect(
      screen.getByRole("heading", { name: /Accounting Firm Portal/i, level: 1 }),
    ).toBeInTheDocument();
  });

  it("renders the shared VAT classes and integration scopes", () => {
    renderApp();
    for (const vc of VatClass.options) {
      expect(screen.getByText(vc)).toBeInTheDocument();
    }
    for (const scope of OAUTH_SCOPES) {
      expect(screen.getByText(scope)).toBeInTheDocument();
    }
  });
});
