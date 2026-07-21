import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { installVireonBridge } from "./bridge/vireon";
import App from "./App";
import { bootTheme } from "./shared/theme";
import "./styles/tokens.css";
import "./styles/global.css";
import "./styles/settings.css";
import "./styles/crypto-ui.css";
import "./styles/pages-ui.css";
import "./styles/theme-motion.css";
import "./styles/dialogs-notifications.css";
import "./styles/app-advanced.css";
import "./styles/light-theme-fix.css";
import "./styles/mining-scene.css";
import { NotificationsProvider } from "./shared/notifications";

// Apply theme before first paint (also guarded by inline script in index.html).
bootTheme();
installVireonBridge();

const root = document.getElementById("root");
if (!root) throw new Error("Vireon renderer root is unavailable");
createRoot(root).render(
  <StrictMode>
    <NotificationsProvider>
      <App />
    </NotificationsProvider>
  </StrictMode>
);
