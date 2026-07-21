import { Maximize2, Minus, X } from "lucide-react";
import { VireonLogo } from "../brand/VireonLogo";

export function TitleBar() {
  const platform = window.vireon.app.platform;
  const product =
    platform === "linux"
      ? "Vireon Linux"
      : platform === "windows"
        ? "Vireon Control Center"
        : "Vireon";

  return (
    <div className="titlebar" data-tauri-drag-region>
      <div className="titlebar-brand" data-tauri-drag-region>
        <VireonLogo size="xs" alt="" />
        <strong>{product}</strong>
        <small>Mainnet Candidate</small>
      </div>
      <div className="window-actions">
        <button type="button" aria-label="Minimize" onClick={() => void window.vireon.app.minimize()}>
          <Minus size={15} />
        </button>
        <button type="button" aria-label="Maximize" onClick={() => void window.vireon.app.maximize()}>
          <Maximize2 size={14} />
        </button>
        <button type="button" aria-label="Close" onClick={() => void window.vireon.app.close()}>
          <X size={15} />
        </button>
      </div>
    </div>
  );
}
