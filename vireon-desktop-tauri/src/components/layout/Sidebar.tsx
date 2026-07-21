import {
  Activity, Blocks, Box, Coins, Compass, Cpu, Gauge, Layers, ListTree, Network,
  ScrollText, Send, Settings, WalletCards
} from "lucide-react";
import type { PageId } from "../../model";
import { VireonLogo } from "../brand/VireonLogo";

type NavItem = { id: PageId; label: string; icon: typeof Activity };

const groups: Array<{ label: string; items: NavItem[] }> = [
  {
    label: "Portfolio",
    items: [
      { id: "overview", label: "Overview", icon: Gauge },
      { id: "wallet", label: "Wallet", icon: WalletCards },
      { id: "send", label: "Send & Receive", icon: Send },
      { id: "rewards", label: "Rewards", icon: Coins },
      { id: "assets", label: "Assets", icon: Box }
    ]
  },
  {
    label: "Network",
    items: [
      { id: "mining", label: "Miner", icon: Cpu },
      { id: "pool", label: "Pool", icon: Layers },
      { id: "explorer", label: "Explorer", icon: Compass },
      { id: "blocks", label: "Blocks", icon: Blocks },
      { id: "transactions", label: "Transactions", icon: Activity },
      { id: "mempool", label: "Mempool", icon: ListTree },
      { id: "node", label: "Network", icon: Network }
    ]
  },
  {
    label: "System",
    items: [
      { id: "activity", label: "Activity", icon: ScrollText },
      { id: "settings", label: "Settings", icon: Settings }
    ]
  }
];

export function Sidebar({
  page,
  setPage,
  nodeRunning,
  height,
  online
}: {
  page: PageId;
  setPage(page: PageId): void;
  nodeRunning: boolean;
  height?: number | null;
  online?: boolean;
}) {
  const live = online || nodeRunning;

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className={`brand-mark ${live ? "is-online" : "is-offline"}`}>
          <VireonLogo size="lg" alt="Vireon Network" />
        </div>
        <div className="brand-name">VIREON</div>
        <div className="brand-subtitle">Control Center</div>
      </div>

      <nav className="nav" aria-label="Primary">
        {groups.map((group) => (
          <div key={group.label} className="nav-group">
            <div className="nav-group-label">{group.label}</div>
            {group.items.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                className={`nav-button ${page === id ? "active" : ""}`}
                onClick={() => setPage(id)}
              >
                <Icon size={17} strokeWidth={1.75} />
                <span>{label}</span>
              </button>
            ))}
          </div>
        ))}
      </nav>

      <div className="panel sidebar-status">
        <div className="eyebrow">Mainnet Candidate</div>
        <p className={live ? "positive" : "muted"}>
          {live ? "Gateway live" : "Gateway offline"}
        </p>
        <div className={`status-live ${live ? "" : "offline"}`}>
          <i />
          {height != null ? `Height ${height}` : "Waiting for tip"} · VPS RPC
        </div>
      </div>
    </aside>
  );
}
