import { TooltipProvider } from "@everr/ui/components/tooltip";
import type { Decorator, Preview } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "./theme.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

const withProviders: Decorator = (Story) => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <div className="bg-background text-foreground p-6">
        <Story />
      </div>
    </TooltipProvider>
  </QueryClientProvider>
);

const preview: Preview = {
  decorators: [withProviders],
  parameters: {
    layout: "fullscreen",
    controls: { expanded: true },
  },
};

export default preview;
