import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ServerIcon } from "lucide-react";
import { useState } from "react";
import { describe, expect, it } from "vite-plus/test";
import { ExploreFilterPill } from "./explore-filter-pill";

function Pill() {
  const [values, setValues] = useState(["api"]);
  return (
    <ExploreFilterPill
      label="Service"
      icon={ServerIcon}
      values={values}
      onChange={setValues}
      options={{
        queryKey: ["services"],
        queryFn: async () => [],
        select: (data: string[]) => data,
      }}
      placeholder="All services"
      labelId="service-label"
    />
  );
}

describe("ExploreFilterPill", () => {
  it("keeps focus on the pill after clearing it from the keyboard", async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Pill />
      </QueryClientProvider>,
    );
    screen.getByLabelText("Clear Service filter").focus();
    await userEvent.keyboard("{Enter}");

    expect(document.activeElement).toBe(screen.getByRole("combobox"));
  });
});
