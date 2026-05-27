import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { TraceFilters } from "./trace-filters";

function renderWithQueryClient(children: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  );
}

describe("TraceFilters", () => {
  it("aligns the status toggle with the other filter controls", () => {
    renderWithQueryClient(
      <TraceFilters
        value={{
          namespace: [],
          service: [],
          name: "",
          status: "all",
        }}
        identities={[
          {
            serviceNamespace: "frontend",
            serviceName: "web",
          },
        ]}
        onChange={() => {}}
      />,
    );

    expect(screen.getByRole("group", { name: "Status" })).toHaveAttribute(
      "data-size",
      "lg",
    );
    expect(screen.getByRole("button", { name: "Ok" })).toHaveClass(
      "bg-transparent",
    );
  });
});
