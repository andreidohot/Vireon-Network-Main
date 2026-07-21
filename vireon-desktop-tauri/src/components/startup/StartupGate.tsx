import { CheckCircle2, CircleGauge, KeyRound, LoaderCircle, Plus, RadioTower, WalletCards } from "lucide-react";
import { useEffect, useState } from "react";
import type { NetworkSnapshot, WalletMetadata } from "@shared/types";
import { VireonLogo } from "../brand/VireonLogo";
import { RecoveryPhraseImport } from "../wallet/RecoveryPhraseImport";
import { startupAccessMode } from "./startupPolicy";

interface StartupGateProps {
  snapshot: NetworkSnapshot;
  wallets: WalletMetadata[];
  activeWallet: WalletMetadata | null;
  busy: boolean;
  error: string | null;
  onSelect(walletId: string): Promise<void>;
  onCreate(displayName: string): Promise<void>;
  onImport(displayName: string): Promise<void>;
  onStartServices(): Promise<void>;
  onAddSeed(seed: string): Promise<void>;
  onRefresh(): Promise<void>;
  onContinue(): void;
}

export function StartupGate(props: StartupGateProps) {
  const [stage, setStage] = useState<"wallet" | "sync">(props.activeWallet ? "sync" : "wallet");
  const [displayName, setDisplayName] = useState("Primary wallet");
  const [importOpen, setImportOpen] = useState(false);

  useEffect(() => {
    if (!props.activeWallet) setStage("wallet");
  }, [props.activeWallet]);

  // Auto-refresh while waiting for gateway readiness.
  useEffect(() => {
    if (stage !== "sync") return;
    const timer = window.setInterval(() => {
      void props.onRefresh();
    }, 4_000);
    return () => window.clearInterval(timer);
  }, [stage, props.onRefresh]);

  const syncKnown = props.snapshot.sync_target_height !== null && props.snapshot.sync_progress_percent !== null;
  const accessMode = startupAccessMode(props.snapshot);
  const canContinue = accessMode !== "blocked" && props.activeWallet !== null;
  const gatewayHeight = props.snapshot.height ?? 0;
  const remoteMode = /vps gateway/i.test(props.snapshot.detail) || props.snapshot.online;

  return (
    <div className="startup-overlay" role="dialog" aria-modal="true" aria-label="Vireon startup verification">
      <section className="startup-gate">
        <div className="startup-rail">
          <div className="startup-emblem">
            <VireonLogo size="md" alt="Vireon" />
          </div>
          <div className={stage === "wallet" ? "startup-step active" : "startup-step complete"}>
            <WalletCards size={18} />
            <span>
              <b>Wallet</b>
              <small>Select identity</small>
            </span>
          </div>
          <div className={stage === "sync" ? "startup-step active" : "startup-step"}>
            <RadioTower size={18} />
            <span>
              <b>VPS chain</b>
              <small>Verify gateway state</small>
            </span>
          </div>
          <p>
            Mainnet Candidate
            <br />
            <small>Prototype software. Not a public mainnet launch.</small>
          </p>
        </div>

        <div className="startup-content">
          {stage === "wallet" ? (
            <>
              <div className="startup-heading">
                <KeyRound size={24} />
                <div>
                  <span>Secure startup</span>
                  <h2>Choose your wallet</h2>
                  <p>The selected wallet becomes the active identity for balances, signing and mining rewards on the VPS network.</p>
                </div>
              </div>
              <div className="wallet-selector">
                {props.wallets.map((wallet) => (
                  <button
                    key={wallet.wallet_id}
                    className={`wallet-option ${props.activeWallet?.wallet_id === wallet.wallet_id ? "selected" : ""}`}
                    disabled={props.busy}
                    onClick={() => void props.onSelect(wallet.wallet_id)}
                  >
                    <span className="wallet-option-icon">
                      <WalletCards size={20} />
                    </span>
                    <span>
                      <b>{wallet.display_name}</b>
                      <small>{shortAddress(wallet.address)}</small>
                    </span>
                    {props.activeWallet?.wallet_id === wallet.wallet_id && <CheckCircle2 className="positive" size={18} />}
                  </button>
                ))}
                {!props.wallets.length && (
                  <div className="wallet-empty">
                    <WalletCards size={30} />
                    <b>No wallet found</b>
                    <span>Create a new 24-word recovery wallet or import an existing one. Keys stay on this device.</span>
                  </div>
                )}
              </div>
              <label className="field startup-name">
                <span>Wallet name</span>
                <input value={displayName} maxLength={48} onChange={(event) => setDisplayName(event.target.value)} />
              </label>
              <div className="startup-actions">
                <button className="button" disabled={props.busy || !displayName.trim()} onClick={() => setImportOpen(true)}>
                  <KeyRound size={16} />
                  Import 24 words
                </button>
                <button className="button primary" disabled={props.busy || !displayName.trim()} onClick={() => void props.onCreate(displayName)}>
                  <Plus size={16} />
                  Create wallet
                </button>
                <button className="button primary" disabled={props.busy || !props.activeWallet} onClick={() => setStage("sync")}>
                  Continue to VPS sync
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="startup-heading">
                <CircleGauge size={24} />
                <div>
                  <span>Network verification</span>
                  <h2>{syncTitle(props.snapshot.sync_status, accessMode)}</h2>
                  <p>{syncDescription(props.snapshot, accessMode)}</p>
                </div>
              </div>
              <div className={`sync-visual sync-${props.snapshot.sync_status}`}>
                <div className="sync-orbit">
                  <LoaderCircle size={38} />
                  <strong>{syncKnown ? `${props.snapshot.sync_progress_percent?.toFixed(2)}%` : gatewayHeight > 0 ? "100%" : "..."}</strong>
                </div>
                <div className="sync-metrics">
                  <span>
                    <small>Gateway height</small>
                    <b>{gatewayHeight.toLocaleString()}</b>
                  </span>
                  <span>
                    <small>Network target</small>
                    <b>{props.snapshot.sync_target_height?.toLocaleString() ?? (gatewayHeight > 0 ? gatewayHeight.toLocaleString() : "Discovering")}</b>
                  </span>
                  <span>
                    <small>Remaining</small>
                    <b>{props.snapshot.sync_remaining_blocks?.toLocaleString() ?? (gatewayHeight > 0 ? "0" : "Unknown")}</b>
                  </span>
                  <span>
                    <small>Fleet online</small>
                    <b>{props.snapshot.fleet_online_nodes ?? props.snapshot.validated_peer_count}</b>
                  </span>
                </div>
              </div>
              <div className="sync-progress" aria-label="Blockchain synchronization progress">
                <i style={{ width: `${props.snapshot.sync_progress_percent ?? (gatewayHeight > 0 ? 100 : 0)}%` }} />
              </div>
              <div className="startup-actions">
                <button className="button" disabled={props.busy} onClick={() => setStage("wallet")}>
                  Change wallet
                </button>
                <button className="button" disabled={props.busy} onClick={() => void props.onRefresh()}>
                  Check gateway again
                </button>
                <button className="button primary" disabled={!canContinue} onClick={props.onContinue}>
                  {accessMode === "network-synced" || accessMode === "gateway-ready"
                    ? "Open control panel"
                    : accessMode === "local-isolated"
                      ? "Open isolated panel"
                      : "Waiting for VPS RPC"}
                </button>
              </div>
              {(accessMode === "gateway-ready" || accessMode === "network-synced") && (
                <p className="startup-isolated">
                  Connected to the VPS RPC gateway. This PC does not run a local chain stack. Mining and transfers use the remote gateway.
                </p>
              )}
              {accessMode === "blocked" && (
                <p className="startup-blocked">
                  {remoteMode
                    ? "Cannot reach the VPS RPC gateway yet. Check Settings > Network > RPC URL (default https://rpcnode.dohotstudio.com) and that the VPS node/RPC services are online."
                    : "RPC gateway is offline. Configure the VPS endpoint in Settings and ensure the server is running."}
                </p>
              )}
            </>
          )}
          {props.error && <div className="notice error startup-error">{props.error}</div>}
        </div>
        <RecoveryPhraseImport
          open={importOpen}
          walletName={displayName}
          busy={props.busy}
          onClose={() => setImportOpen(false)}
          onImport={props.onImport}
        />
      </section>
    </div>
  );
}

function shortAddress(address: string): string {
  return address.length > 22 ? `${address.slice(0, 12)}...${address.slice(-8)}` : address;
}

function syncTitle(status: NetworkSnapshot["sync_status"], mode: ReturnType<typeof startupAccessMode>): string {
  if (mode === "network-synced" || status === "synced") return "VPS chain ready";
  if (status === "syncing" || mode === "gateway-ready") return "Gateway synchronized";
  if (status === "discovering") return "Contacting VPS gateway";
  return "VPS RPC is offline";
}

function syncDescription(snapshot: NetworkSnapshot, mode: ReturnType<typeof startupAccessMode>): string {
  if (mode === "network-synced" || snapshot.sync_status === "synced") {
    return "The VPS gateway reports a live Mainnet Candidate tip. You can open the panel and start mining against the remote chain.";
  }
  if (snapshot.sync_status === "syncing") {
    return `The VPS node is still catching up (${snapshot.sync_remaining_blocks ?? 0} blocks remaining). Mining waits until the tip is stable.`;
  }
  if (mode === "gateway-ready") {
    return "Gateway answered with chain data. Peer discovery may still be incomplete on the server; the desktop session can continue.";
  }
  if (snapshot.sync_status === "discovering") {
    return "Waiting for the configured RPC gateway to answer /status with chain height.";
  }
  return "Configure the VPS RPC URL and verify the server is reachable before opening the control panel.";
}
