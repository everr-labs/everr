import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Server } from "lucide-react";
import { expect, it, vi } from "vite-plus/test";
import { ExploreFilterPill } from "./explore-filter-pill";

it("connects the filter trigger to its rendered popup and the search input to its list", async () => {
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <ExploreFilterPill
        label="Service"
        icon={Server}
        values={[]}
        onChange={vi.fn()}
        options={{
          queryKey: ["pill-aria"],
          queryFn: async () => ["api"],
          select: (items: string[]) => items,
        }}
        placeholder="All services"
      />
    </QueryClientProvider>,
  );
  const trigger = screen.getByRole("combobox");
  await userEvent.setup().click(trigger);
  const list = await screen.findByRole("listbox");
  const popup = document.getElementById(trigger.getAttribute("aria-controls") ?? "");
  expect(popup).toBeInTheDocument();
  expect(popup).toHaveAttribute("role", trigger.getAttribute("aria-haspopup"));
  expect(popup).toContainElement(list);
  const search = screen.getByPlaceholderText("Search...");
  expect(document.getElementById(search.getAttribute("aria-controls") ?? "")).toBe(list);
  client.clear();
});
