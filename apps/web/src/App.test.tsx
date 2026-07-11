import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import App from "./App";
import { AuthProvider } from "./auth/AuthContext";

function renderAt(path: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("App routing", () => {
  beforeEach(() => localStorage.clear());

  it("redirects an unauthenticated visitor to the sign-in page", async () => {
    renderAt("/");
    await waitFor(() =>
      expect(screen.getByText(/Sign in to continue/i)).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("heading", { name: /Sign in/i }),
    ).toBeInTheDocument();
  });

  it("renders the invitation acceptance page", async () => {
    renderAt("/accept?token=abc");
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: /Accept your invitation/i }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText(/Activate account/i)).toBeInTheDocument();
  });
});
