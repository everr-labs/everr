import { QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "better-themes";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { APP_DISPLAY_NAME } from "./lib/app-name";
import { createQueryClient } from "./lib/query-client";
import "@everr/ui/styles/global.css";
import "./styles.css";

const queryClient = createQueryClient();
document.title = APP_DISPLAY_NAME;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" disableTransitionOnChange>
        <App />
      </ThemeProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
