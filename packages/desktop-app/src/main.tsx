import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import React from "react";
import ReactDOM from "react-dom/client";
import { NotificationWindow } from "./features/notifications/notification-window";
import { APP_DISPLAY_NAME } from "./lib/app-name";
import { createQueryClient } from "./lib/query-client";
import { NOTIFICATION_WINDOW_LABEL, resolveWindowLabel } from "./lib/tauri";
import { router } from "./router";
import "@/styles/desktop-app.css";

const queryClient = createQueryClient();
document.title = APP_DISPLAY_NAME;

const isNotification = resolveWindowLabel() === NOTIFICATION_WINDOW_LABEL;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      {isNotification ? (
        <NotificationWindow />
      ) : (
        <RouterProvider router={router} />
      )}
    </QueryClientProvider>
  </React.StrictMode>,
);
