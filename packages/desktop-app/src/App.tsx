import { DesktopWindow } from "./features/desktop-shell/desktop-window";
import { NotificationWindow } from "./features/notifications/notification-window";
import { NOTIFICATION_WINDOW_LABEL, resolveWindowLabel } from "./lib/tauri";

function App() {
  return resolveWindowLabel() === NOTIFICATION_WINDOW_LABEL ? (
    <NotificationWindow />
  ) : (
    <DesktopWindow />
  );
}

export default App;
