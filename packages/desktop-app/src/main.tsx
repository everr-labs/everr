import "./lib/telemetry";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import React from "react";
import ReactDOM from "react-dom/client";
import { NotificationWindow } from "./features/notifications/notification-window";
import { APP_DISPLAY_NAME } from "./lib/app-name";
import { createQueryClient } from "./lib/query-client";
import { ReactTelemetryErrorBoundary } from "./lib/react-error-boundary";
import { NOTIFICATION_WINDOW_LABEL, resolveWindowLabel } from "./lib/tauri";
import { router } from "./router";
import "@/styles/desktop-app.css";

const queryClient = createQueryClient();
document.title = APP_DISPLAY_NAME;

const isNotification = resolveWindowLabel() === NOTIFICATION_WINDOW_LABEL;

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element #root not found");

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <ReactTelemetryErrorBoundary>
      <QueryClientProvider client={queryClient}>
        {isNotification ? <NotificationWindow /> : <RouterProvider router={router} />}
      </QueryClientProvider>
    </ReactTelemetryErrorBoundary>
  </React.StrictMode>,
);
