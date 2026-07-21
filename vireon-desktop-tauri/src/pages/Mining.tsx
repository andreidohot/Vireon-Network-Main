import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  CircuitBoard,
  Copy,
  Download,
  HardDrive,
  Play,
  Square,
  Terminal,
  Users,
  Zap
} from "lucide-react";
import { LIVE_LOG_INTERVAL_MS } from "@shared/constants";
import { formatBytes, formatCompactCount, formatHashrate, shortHash } from "@shared/format";
import type { MiningDeviceInfo } from "@shared/types";
import { TelemetryChart } from "../components/charts/TelemetryChart";
import { BarChart } from "../components/charts/BarChart";
import { ConfirmDialog } from "../components/dialogs/ConfirmDialog";
import { PageHero } from "../components/ui/PageHero";
import { KeyValue, Panel } from "../components/ui/Panel";
import { StatCard } from "../components/ui/StatCard";
import { MiningCore } from "../components/visual/MiningCore";
import { useAppSettings } from "../hooks/useAppSettings";
import { useNotificationsOptional } from "../shared/notifications";
import { appendSample, type SeriesPoint } from "../shared/chartPath";
import { useApp } from "../model";

type BackendMode = "cuda";

const FORM_KEY = "vireon.miner.form.v3";
const LOG_SESSION_KEY = "vireon.miner.sessionLog.v1";
const CONSOLE_LINES = 400;

function normalizeBackend(_raw: unknown): BackendMode {
  return "cuda";
}

type MinerForm = {
  mode: "solo" | "pool";
  backend: BackendMode;
  gpuIntensity: number;
  poolUrl: string;
  workerName: string;
  gpuDevices: string[];
};

function extractHexHashes(text: string): string[] {
  return (text.match(/\b[a-f0-9]{16,64}\b/gi) ?? []).slice(-8);
}

function loadSessionForm(): Partial<MinerForm> | null {
  try {
    const raw = sessionStorage.getItem(FORM_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Partial<MinerForm>;
  } catch {
    return null;
  }
}

function saveSessionForm(form: MinerForm) {
  try {
    sessionStorage.setItem(FORM_KEY, JSON.stringify(form));
  } catch {
    /* ignore quota */
  }
}

function appendSessionLog(chunk: string) {
  if (!chunk.trim()) return;
  try {
    const prev = sessionStorage.getItem(LOG_SESSION_KEY) ?? "";
    // Keep last ~1.5MB of text for full-session console.
    const next = `${prev}${prev && !prev.endsWith("\n") ? "\n" : ""}${chunk}`;
    const trimmed = next.length > 1_500_000 ? next.slice(next.length - 1_500_000) : next;
    sessionStorage.setItem(LOG_SESSION_KEY, trimmed);
  } catch {
    /* ignore */
  }
}

function readSessionLog(): string {
  try {
    return sessionStorage.getItem(LOG_SESSION_KEY) ?? "";
  } catch {
    return "";
  }
}

function clearSessionLog() {
  try {
    sessionStorage.removeItem(LOG_SESSION_KEY);
  } catch {
    /* ignore */
  }
}

export function Mining() {
  const { snapshot: n, wallet, operator, setNotice, refresh } = useApp();
  const { settings, update: updateSettings } = useAppSettings();
  const session = loadSessionForm();
  const [mode, setMode] = useState<"solo" | "pool">(
    session?.mode ?? settings.default_miner_mode
  );
  const [backend, setBackend] = useState<BackendMode>(
    normalizeBackend(session?.backend ?? settings.default_miner_backend ?? "cuda")
  );
  const [gpuIntensity, setGpuIntensity] = useState(
    session?.gpuIntensity ?? (settings.default_gpu_intensity || 75)
  );
  const [poolUrl, setPoolUrl] = useState(session?.poolUrl ?? settings.default_pool_url);
  const [workerName, setWorkerName] = useState(
    session?.workerName ?? settings.default_worker_name
  );
  const [gpuDevices, setGpuDevices] = useState<string[]>(
    session?.gpuDevices ?? settings.default_gpu_devices ?? []
  );
  const [hydrated, setHydrated] = useState(Boolean(session));
  const [history, setHistory] = useState<SeriesPoint[]>([]);
  const [consoleOutput, setConsoleOutput] = useState(() => readSessionLog());
  const [commandOutput, setCommandOutput] = useState("");
  const [devices, setDevices] = useState<MiningDeviceInfo[]>([]);
  const [devicesError, setDevicesError] = useState<string | null>(null);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const consoleRef = useRef<HTMLPreElement>(null);
  const lastLogFingerprint = useRef("");
  const notifications = useNotificationsOptional();
  const [stopOpen, setStopOpen] = useState(false);
  const persistTimer = useRef<number | null>(null);

  // Hydrate from durable settings once (session form wins if present).
  useEffect(() => {
    if (hydrated) return;
    if (session) {
      setHydrated(true);
      return;
    }
    setMode(settings.default_miner_mode);
    setBackend(normalizeBackend(settings.default_miner_backend || "cuda"));
    setGpuIntensity(settings.default_gpu_intensity || 75);
    setPoolUrl(settings.default_pool_url);
    setWorkerName(settings.default_worker_name);
    setGpuDevices(settings.default_gpu_devices ?? []);
    setHydrated(true);
  }, [settings, hydrated, session]);

  // Persist form to sessionStorage immediately + settings (debounced).
  useEffect(() => {
    if (!hydrated) return;
    const form: MinerForm = {
      mode,
      backend,
      gpuIntensity,
      poolUrl,
      workerName,
      gpuDevices
    };
    saveSessionForm(form);
    if (persistTimer.current) window.clearTimeout(persistTimer.current);
    persistTimer.current = window.setTimeout(() => {
      void updateSettings({
        default_miner_mode: mode,
        default_miner_backend: backend,
        default_gpu_intensity: gpuIntensity,
        default_gpu_devices: gpuDevices,
        default_pool_url: poolUrl,
        default_worker_name: workerName
      });
    }, 400);
    return () => {
      if (persistTimer.current) window.clearTimeout(persistTimer.current);
    };
  }, [
    hydrated,
    mode,
    backend,
    gpuIntensity,
    poolUrl,
    workerName,
    gpuDevices,
    updateSettings
  ]);

  useEffect(() => {
    if (n.miner_hashrate_hs !== null) {
      const ts =
        n.miner_updated_at_unix_seconds !== null
          ? n.miner_updated_at_unix_seconds * 1000
          : Date.now();
      setHistory((values) => appendSample(values, n.miner_hashrate_hs!, 60, ts));
    }
  }, [n.miner_hashrate_hs, n.miner_updated_at_unix_seconds]);

  const recentHashes = useMemo(() => {
    const fromLogs = extractHexHashes([commandOutput, consoleOutput].join("\n"));
    const chain = [n.tip_hash, n.miner_template_id].filter(Boolean) as string[];
    return [...fromLogs, ...chain].slice(0, 8);
  }, [commandOutput, consoleOutput, n.tip_hash, n.miner_template_id]);

  // Live miner console: poll faster while mining; merge log + status telemetry.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const chunk = await window.vireon.logs.recent("miner", CONSOLE_LINES);
        if (cancelled) return;
        // Drop TRACE/DEBUG noise only; keep hashrate/status/error lines.
        const filtered = (chunk || "")
          .split("\n")
          .filter((line) => {
            const t = line.trim();
            if (!t) return false;
            if (t.includes("[TRACE]") || t.includes("[DEBUG]")) return false;
            return true;
          })
          .join("\n");
        const statusLine =
          n.miner_running
            ? [
                `[status] ${n.miner_status ?? "mining"}`,
                n.miner_hashrate_hs != null ? `hashrate=${formatHashrate(n.miner_hashrate_hs)}` : null,
                n.miner_accepted_shares != null ? `shares=${n.miner_accepted_shares}` : null,
                n.miner_accepted_blocks != null ? `blocks=${n.miner_accepted_blocks}` : null,
                n.miner_active_backend ? `backend=${n.miner_active_backend}` : null,
                n.miner_height != null ? `height=${n.miner_height}` : null
              ]
                .filter(Boolean)
                .join(" ")
            : "";
        const combined = [filtered, statusLine].filter(Boolean).join("\n");
        if (!combined.trim()) return;
        // Fingerprint full tail so frequent rewrites of the same length still refresh.
        const fp = `${combined.length}|${combined.slice(-240)}|${n.miner_hashrate_hs ?? 0}|${n.miner_accepted_shares ?? 0}`;
        if (fp === lastLogFingerprint.current) return;
        lastLogFingerprint.current = fp;
        setConsoleOutput(combined);
        appendSessionLog(combined.slice(-8_000));
      } catch {
        /* ignore transient log read errors */
      }
    };
    void load();
    // Local log tail only (does not hit VPS RPC). Keep mining console snappy locally;
    // idle uses settings cadence so we do not thrash disk while waiting.
    const interval = n.miner_running
      ? 1_500
      : Math.max(3_000, settings.live_log_interval_ms || LIVE_LOG_INTERVAL_MS);
    const timer = window.setInterval(() => void load(), interval);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [
    settings.live_log_interval_ms,
    n.miner_running,
    n.miner_status,
    n.miner_hashrate_hs,
    n.miner_accepted_shares,
    n.miner_accepted_blocks,
    n.miner_active_backend,
    n.miner_height
  ]);

  useEffect(() => {
    if (autoScroll && consoleRef.current) {
      consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
    }
  }, [consoleOutput, commandOutput, autoScroll]);

  const refreshDevices = useCallback(async () => {
    setDevicesLoading(true);
    setDevicesError(null);
    try {
      const list = (await window.vireon.miner.devices()) as MiningDeviceInfo[];
      const rows = Array.isArray(list) ? list : [];
      setDevices(rows);
      const gpuIds = rows
        .filter((d) => {
          const b = String(d.backend ?? "").toLowerCase();
          return b.includes("cuda");
        })
        .map((d) => d.id)
        .filter(Boolean);
      if (gpuIds.length) {
        setGpuDevices((prev) => {
          // Single physical GPU: always pin that one id (never fake "multi").
          if (gpuIds.length === 1) return [gpuIds[0]];
          if (prev.length === 0) return gpuIds;
          const kept = prev.filter((id) => gpuIds.includes(id));
          return kept.length ? kept : gpuIds;
        });
      } else {
        setGpuDevices([]);
      }
    } catch (error) {
      setDevices([]);
      setDevicesError(String(error).replace(/^Error:\s*/i, ""));
    } finally {
      setDevicesLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshDevices();
  }, [refreshDevices]);

  const run = async (command: "miner-start" | "miner-stop") => {
    if (command === "miner-stop" && settings.confirm_before_operator) {
      setStopOpen(true);
      return;
    }
    try {
      if (command === "miner-start") {
        clearSessionLog();
        lastLogFingerprint.current = "";
        setConsoleOutput("");
        const banner = [
          `── miner start ${new Date().toISOString()} ──`,
          `mode=${mode} backend=${backend} gpu_intensity=${gpuIntensity}`,
          gpuDevices.length ? `gpu_devices=${gpuDevices.join(",")}` : "gpu_devices=auto",
          mode === "pool" ? `pool=${poolUrl} worker=${workerName}` : "work=solo RPC"
        ].join("\n");
        appendSessionLog(banner);
        setConsoleOutput(banner);
      }
      const output = await operator(
        command,
        command === "miner-start"
          ? {
              mode,
              backend,
              gpu_intensity: gpuIntensity,
              gpu_devices: gpuDevices,
              pool_url: poolUrl,
              worker_name: workerName
            }
          : undefined
      );
      setCommandOutput(output);
      appendSessionLog(output);
      setStopOpen(false);
      setNotice({
        error: false,
        text: command === "miner-start" ? `Miner started (${backend}).` : "Miner stopped."
      });
      notifications?.notify({
        kind: command === "miner-start" ? "success" : "info",
        title: command === "miner-start" ? "Miner started" : "Miner stopped",
        body:
          command === "miner-start"
            ? `Backend ${backend} · mode ${mode}`
            : "Local miner process stop requested.",
        source: `miner:${command}`
      });
      await refresh();
    } catch (error) {
      const message = String(error).replace(/^Error:\s*/i, "");
      setCommandOutput(message);
      appendSessionLog(message);
      setNotice({
        error: true,
        text:
          message.length > 180
            ? "Miner command failed. See Miner Console below for the full error."
            : message
      });
      notifications?.notify({
        kind: "error",
        title: "Miner command failed",
        body: message.slice(0, 220),
        sticky: true,
        source: `miner:${command}`
      });
    }
  };

  const confirmStop = async () => {
    try {
      const output = await operator("miner-stop");
      setCommandOutput(output);
      appendSessionLog(output);
      setStopOpen(false);
      setNotice({ error: false, text: "Miner stopped." });
      notifications?.notify({
        kind: "info",
        title: "Miner stopped",
        body: "Local miner process stop confirmed.",
        source: "miner:miner-stop"
      });
      await refresh();
    } catch (error) {
      const message = String(error).replace(/^Error:\s*/i, "");
      setCommandOutput(message);
      setNotice({ error: true, text: message });
    }
  };

  const copyConsole = async () => {
    const text = [commandOutput, consoleOutput].filter(Boolean).join("\n\n");
    try {
      await navigator.clipboard.writeText(text);
      setNotice({ error: false, text: "Console copied to clipboard." });
    } catch {
      setNotice({ error: true, text: "Could not copy console." });
    }
  };

  const exportConsole = async () => {
    try {
      const path = await window.vireon.logs.export("miner");
      if (path) setNotice({ error: false, text: `Exported logs to ${path}` });
    } catch (error) {
      setNotice({ error: true, text: String(error).replace(/^Error:\s*/i, "") });
    }
  };

  const toggleGpu = (id: string) => {
    setGpuDevices((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const telemetryAge =
    n.miner_updated_at_unix_seconds === null
      ? "n/a"
      : `${Math.max(0, Math.floor(Date.now() / 1000) - n.miner_updated_at_unix_seconds)}s ago`;
  const acceptedBlocks = n.miner_accepted_blocks ?? 0;
  const acceptedShares = n.miner_accepted_shares ?? 0;
  const accepted = mode === "pool" ? acceptedShares : acceptedBlocks;
  const logCadence = Math.max(
    1,
    Math.round((settings.live_log_interval_ms || LIVE_LOG_INTERVAL_MS) / 1000)
  );
  const backends: Array<{ id: BackendMode; label: string }> = [
    { id: "cuda", label: "CUDA (NVIDIA GPU)" }
  ];
  const backendLabel = "CUDA (NVIDIA GPU)";
  const activeBackend = n.miner_active_backend ?? n.miner_backend_mode ?? backendLabel;

  const gpuList = devices.filter((d) => {
    const b = String(d.backend ?? "").toLowerCase();
    return (
      b.includes("cuda")
    );
  });

  // Solo vs official pool - real signals only (never invent miners).
  const poolWorkers = n.pool_workers ?? 0;
  const p2pMiners = n.miners?.length ?? 0;
  const localSolo = n.miner_running && mode === "solo" ? 1 : 0;
  const localPool = n.miner_running && mode === "pool" ? 1 : 0;
  // Solo = P2P miner presence + local solo (do not double-count pool workers).
  const soloMiners = Math.max(p2pMiners, 0) + localSolo;
  const poolMiners = poolWorkers + localPool;
  // Prefer live local hashrate when mining; fold into network view for solo.
  const localHs = n.miner_running ? (n.miner_hashrate_hs ?? 0) : 0;
  const poolHs = n.pool_hashrate_hs ?? 0;
  const networkHs = Math.max(
    n.observed_network_hashrate_hs ?? 0,
    mode === "solo" ? localHs : 0,
    mode === "pool" ? Math.max(poolHs, localHs) : 0
  );

  const fullConsole = [commandOutput, consoleOutput].filter(Boolean).join("\n\n");

  return (
    <div className="page grid miner-page">
      <PageHero
        kicker={n.miner_running ? "POW ACTIVE" : "MINER STANDBY"}
        title="FiroPoW"
        titleAccent="mining deck"
        description="GPU-only FiroPoW 0.9.4 mining on real NVIDIA CUDA kernels, with the DAG generated directly in VRAM. Work comes from VPS RPC (solo) or the official pool."
        actions={
          <>
            <button
              className="button primary"
              type="button"
              disabled={!wallet || n.miner_running}
              onClick={() => void run("miner-start")}
            >
              <Play size={15} /> Start
            </button>
            <button
              className="button danger"
              type="button"
              disabled={!n.miner_running}
              onClick={() => void run("miner-stop")}
            >
              <Square size={15} /> Stop
            </button>
          </>
        }
        side={
          <>
            <div className="page-hero-metric">
              <small>Hashrate</small>
              <strong>
                {n.miner_running
                  ? formatHashrate(n.miner_hashrate_hs ?? 0)
                  : formatHashrate(n.miner_hashrate_hs)}
              </strong>
            </div>
            <div className="page-hero-metric">
              <small>{mode === "pool" ? "Shares" : "Blocks"}</small>
              <strong>{accepted}</strong>
            </div>
            <div className="page-hero-metric">
              <small>Backend</small>
              <strong>{activeBackend}</strong>
            </div>
          </>
        }
      />

      <div className="grid cols-4 telemetry-strip">
        <StatCard
          label="Hashrate"
          value={formatHashrate(n.miner_running ? (n.miner_hashrate_hs ?? 0) : n.miner_hashrate_hs)}
          detail={`${n.miner_active_backend ?? n.miner_backend_mode ?? backendLabel} · ${telemetryAge}`}
          tone={n.miner_running ? "positive" : undefined}
          icon={<Zap size={14} />}
        />
        <StatCard
          label="State"
          value={n.miner_running ? "MINING" : "IDLE"}
          detail={
            n.miner_status
              ? `${n.miner_status}${n.miner_running && mode === "pool" ? ` · shares ${acceptedShares}` : ""}`
              : "No telemetry"
          }
          tone={n.miner_running ? "positive" : undefined}
          icon={<Activity size={14} />}
        />
        <StatCard
          label={mode === "pool" ? "Pool + local H/s" : "Solo / network H/s"}
          value={formatHashrate(networkHs)}
          detail={
            mode === "pool"
              ? `Pool ${formatHashrate(poolHs)} · local ${formatHashrate(localHs)} · workers ${poolMiners}`
              : `Local ${formatHashrate(localHs)} · P2P miners ${soloMiners}`
          }
          icon={<Users size={14} />}
        />
        <StatCard
          label={mode === "pool" ? "Accepted shares" : "Accepted blocks"}
          value={accepted}
          detail={
            mode === "pool"
              ? `Pool shares · blocks ${acceptedBlocks} · net_diff ${n.miner_difficulty_leading_zero_bits ?? "—"}`
              : `Full blocks only · net_diff ${n.miner_difficulty_leading_zero_bits ?? "—"}`
          }
          tone="gold"
          icon={<Terminal size={14} />}
        />
      </div>

      <div className="grid cols-2 miner-presence-row">
        <Panel title="Network miners" detail="Observed · not invented">
          <div className="miner-split-cards">
            <article className="miner-split solo">
              <small>Solo / P2P miners</small>
              <strong>{soloMiners}</strong>
              <span>
                P2P signals {p2pMiners}
                {localSolo ? " · + this PC solo" : ""}
              </span>
              <span className="muted">Direct template / peer presence</span>
            </article>
            <article className="miner-split pool">
              <small>Official pool</small>
              <strong>{poolMiners}</strong>
              <span>
                Workers online {poolWorkers}
                {localPool ? " · + this PC" : ""}
              </span>
              <span className="muted">
                {n.pool_online ? n.pool_name ?? "pool online" : "pool unreachable"} ·{" "}
                {formatHashrate(poolHs)}
              </span>
            </article>
          </div>
        </Panel>
        <Panel title="Observed hashrate" detail="Aggregated live sources">
          <div className="miner-kpi-row dense">
            <span>
              <small>Network</small>
              <strong>{formatHashrate(networkHs)}</strong>
            </span>
            <span>
              <small>Pool</small>
              <strong>{formatHashrate(poolHs)}</strong>
            </span>
            <span>
              <small>Local</small>
              <strong>{formatHashrate(n.miner_hashrate_hs)}</strong>
            </span>
            <span>
              <small>Observed miners</small>
              <strong>{n.mining_peer_count ?? 0}</strong>
            </span>
          </div>
          <p className="muted" style={{ marginTop: 10, lineHeight: 1.5 }}>
            Network H/s combines P2P presence, official pool estimate, fleet nodes and this
            desktop miner when active. Empty P2P alone no longer zeros the meter while pool/local
            hash.
          </p>
        </Panel>
      </div>

      <div className="grid cols-2 miner-main">
        <div className="grid miner-visual-col">
          <MiningCore
            running={n.miner_running}
            hashrate={n.miner_hashrate_hs}
            height={n.miner_height}
            hashesAttempted={n.miner_hashes_attempted}
            acceptedBlocks={n.miner_accepted_blocks}
            acceptedShares={n.miner_accepted_shares}
            networkDifficultyBits={n.miner_difficulty_leading_zero_bits}
            shareDifficultyBits={
              n.miner_share_difficulty_leading_zero_bits ?? n.miner_difficulty_leading_zero_bits
            }
            backend={String(activeBackend)}
            recentHashes={recentHashes}
            consoleText={fullConsole}
          />
          <Panel title="Hashrate signal" detail="Live samples">
            {history.length > 1 ? (
              <TelemetryChart values={history} label="Hashrate" unit="H/s" height={130} />
            ) : (
              <div className="chart-wait">Start mining to collect real hashrate samples.</div>
            )}
            {history.length > 1 ? (
              <div style={{ marginTop: 12 }}>
                <BarChart
                  values={history.slice(-24).map((s) => s.value)}
                  label="Recent windows"
                  unit="H/s"
                  height={80}
                />
              </div>
            ) : null}
            <div className="miner-kpi-row">
              <span>
                <small>Height</small>
                <strong>{n.miner_height ?? n.height ?? "—"}</strong>
              </span>
              <span>
                <small>Difficulty bits</small>
                <strong>{n.miner_difficulty_leading_zero_bits ?? "—"}</strong>
              </span>
              <span>
                <small>Template</small>
                <strong className="mono">{shortHash(n.miner_template_id, 8)}</strong>
              </span>
              <span>
                <small>Hashes</small>
                <strong>{formatCompactCount(n.miner_hashes_attempted)}</strong>
              </span>
            </div>
          </Panel>
        </div>

        <Panel
          title="Miner control"
          detail={`${mode} · ${backendLabel} · saved`}
          className="miner-controls"
        >
          <KeyValue label="Reward address" mono>
            {wallet?.address ?? "Wallet required"}
          </KeyValue>
          <KeyValue label="Active backend">{activeBackend}</KeyValue>
          <KeyValue label="Work source">
            {mode === "pool" ? poolUrl : `${settings.rpc_url || "VPS RPC"} /mining/template`}
          </KeyValue>
          <KeyValue label="Algorithm">FiroPoW 0.9.4 · NVIDIA CUDA GPU</KeyValue>
          <KeyValue label="Selected GPUs">
            {gpuDevices.length ? gpuDevices.join(", ") : "Auto (all / driver default)"}
          </KeyValue>

          <div className="field" style={{ marginTop: 10 }}>
            <label>Work source</label>
            <div className="backend-pills mode-pills">
              <button type="button" className={mode === "pool" ? "active" : ""} onClick={() => setMode("pool")}>
                Official pool (recommended)
              </button>
              <button type="button" className={mode === "solo" ? "active" : ""} onClick={() => setMode("solo")}>
                Solo RPC (full net difficulty)
              </button>
            </div>
            {mode === "solo" ? (
              <p className="muted" style={{ marginTop: 8, fontSize: 12 }}>
                Solo requires full network difficulty (often 30+ bits). A short session can find zero blocks even when
                the miner is healthy. Use the official pool for share difficulty ~18 and visible progress.
              </p>
            ) : null}
          </div>

          <div className="field">
            <label>Compute backend</label>
            <div className="backend-pills">
              {backends.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={backend === item.id ? "active" : ""}
                  onClick={() => setBackend(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div className="compute-deck">
            <section className="compute-pane gpu">
              <header>
                <HardDrive size={15} />
                <div>
                  <strong>GPU mining</strong>
                  <small>
                    CUDA · {gpuList.length} device{gpuList.length === 1 ? "" : "s"} ·
                    intensity {gpuIntensity}%
                  </small>
                </div>
              </header>
              <p className="field-hint">
                Mining runs only on CUDA. CPU and host-emulated backends are unavailable.
              </p>
              <div className="field">
                <label>Intensity (work-items per dispatch)</label>
                <input
                  type="range"
                  min={1}
                  max={100}
                  value={gpuIntensity}
                  onChange={(e) =>
                    setGpuIntensity(Math.max(1, Math.min(100, Number(e.target.value) || 75)))
                  }
                />
                <div className="intensity-row">
                  <strong>{gpuIntensity}%</strong>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={gpuIntensity}
                    onChange={(e) =>
                      setGpuIntensity(Math.max(1, Math.min(100, Number(e.target.value) || 75)))
                    }
                  />
                </div>
              </div>
              <div className="backend-pills mode-pills compact-pills">
                {[
                  { label: "Eco", value: 40 },
                  { label: "Balanced", value: 70 },
                  { label: "High", value: 90 },
                  { label: "Max", value: 100 }
                ].map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    className={gpuIntensity === p.value ? "active" : ""}
                    onClick={() => setGpuIntensity(p.value)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <div className="backend-pills mode-pills compact-pills" style={{ marginTop: 8 }}>
                <button
                  type="button"
                  className={
                    gpuList.length > 0
                      && (gpuDevices.length === 0 || gpuDevices.length === gpuList.length)
                      ? "active"
                      : ""
                  }
                  disabled={gpuList.length === 0}
                  onClick={() => setGpuDevices(gpuList.map((g) => g.id))}
                >
                  {gpuList.length <= 1 ? "This GPU" : "All GPUs"}
                </button>
                <button
                  type="button"
                  className={gpuDevices.length === 1 && gpuList.length > 1 ? "active" : ""}
                  disabled={gpuList.length < 2}
                  onClick={() => {
                    if (gpuList[0]) setGpuDevices([gpuList[0].id]);
                  }}
                >
                  Single
                </button>
                <button
                  type="button"
                  className={gpuDevices.length > 1 && gpuDevices.length < gpuList.length ? "active" : ""}
                  disabled={gpuList.length < 2}
                  onClick={() => setGpuDevices(gpuList.map((g) => g.id))}
                  title="Select every NVIDIA CUDA GPU"
                >
                  Multi
                </button>
              </div>
              {gpuList.length > 0 ? (
                <div className="gpu-check-list">
                  {gpuList.map((gpu) => {
                    const selected = gpuDevices.length === 0 || gpuDevices.includes(gpu.id);
                    return (
                      <label key={gpu.id} className={`gpu-check ${selected ? "on" : ""}`}>
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => {
                            if (gpuDevices.length === 0) {
                              setGpuDevices(gpuList.filter((g) => g.id !== gpu.id).map((g) => g.id));
                              return;
                            }
                            toggleGpu(gpu.id);
                          }}
                        />
                        <span className="mono">{gpu.id}</span>
                        <span>
                          {gpu.name}
                          {gpu.compute_units != null ? ` · ${gpu.compute_units} CU` : ""}
                          {gpu.global_memory_bytes != null
                            ? ` · ${formatBytes(gpu.global_memory_bytes)}`
                            : ""}
                        </span>
                      </label>
                    );
                  })}
                </div>
              ) : (
                <p className="field-hint">
                  No CUDA GPU found. Install a supported NVIDIA driver, then Rescan.
                </p>
              )}
              <p className="field-hint">
                Est. GPU batch ~{formatCompactCount(Math.round(1_048_576 * (gpuIntensity / 100)))}{" "}
                work-items/dispatch. Higher intensity = more VRAM/GPU load.
              </p>
            </section>
          </div>

          {mode === "pool" ? (
            <>
              <div className="field">
                <label>Pool URL</label>
                <input value={poolUrl} onChange={(e) => setPoolUrl(e.target.value)} />
              </div>
              <div className="field">
                <label>Worker name</label>
                <input value={workerName} onChange={(e) => setWorkerName(e.target.value)} />
              </div>
            </>
          ) : null}

          <div className="button-row miner-actions">
            <button
              className="button primary"
              type="button"
              disabled={!wallet || n.miner_running}
              onClick={() => void run("miner-start")}
            >
              <Play size={15} /> Start mining
            </button>
            <button
              className="button danger"
              type="button"
              disabled={!n.miner_running}
              onClick={() => void run("miner-stop")}
            >
              <Square size={15} /> Stop
            </button>
          </div>
          <p className="muted" style={{ marginTop: 10, lineHeight: 1.5 }}>
            Controls auto-save when you leave this page. Restart miner to apply GPU / backend
            changes.
          </p>
        </Panel>
      </div>

      <Panel title="Hardware" detail="Live inventory · GPU-only mining" className="hardware-panel">
        <div className="hardware-shell">
          <div className="hardware-toolbar">
            <button className="button ghost" type="button" onClick={() => void refreshDevices()} disabled={devicesLoading}>
              <CircuitBoard size={14} /> {devicesLoading ? "Scanning…" : "Rescan devices"}
            </button>
            <span className="muted mono" style={{ fontSize: 11 }}>
              backend={backend} · hashes={formatCompactCount(n.miner_hashes_attempted)} · hr=
              {formatHashrate(n.miner_hashrate_hs)}
            </span>
            {devicesError ? <span className="hw-error">{devicesError}</span> : null}
          </div>
          <div className="hardware-grid">
            <article className="hw-card gpu">
              <header>
                <HardDrive size={16} />
                <div>
                  <strong>GPU mining</strong>
                  <small>CUDA FiroPoW 0.9.4 · multi-GPU</small>
                </div>
                <span className={`hw-badge ${gpuList.length ? "on" : ""}`}>
                  {gpuList.length === 0
                    ? "unavailable"
                    : n.miner_running
                      ? "active"
                      : "ready"}
                </span>
              </header>
              <div className="hw-stats">
                <div>
                  <span>Detected</span>
                  <b>{gpuList.length}</b>
                </div>
                <div>
                  <span>Selected</span>
                  <b>
                    {gpuDevices.length === 0
                      ? gpuList.length
                        ? `all (${gpuList.length})`
                        : "—"
                      : gpuDevices.length}
                  </b>
                </div>
                <div>
                  <span>Intensity</span>
                  <b>{gpuIntensity}%</b>
                </div>
                <div>
                  <span>Batch est.</span>
                  <b>{formatCompactCount(Math.round(1_048_576 * (gpuIntensity / 100)))}</b>
                </div>
              </div>
              <div className="hw-meter gold" aria-hidden="true">
                <i style={{ width: `${gpuIntensity}%` }} />
              </div>
              <ul className="hw-list">
                {gpuList.length ? (
                  gpuList.map((d) => {
                    const on = gpuDevices.length === 0 || gpuDevices.includes(d.id);
                    return (
                      <li
                        key={d.id}
                        className={on ? "on" : ""}
                        role="button"
                        tabIndex={0}
                        title="Click to toggle GPU selection"
                        onClick={() => {
                          setGpuDevices((prev) => {
                            const allIds = gpuList.map((g) => g.id);
                            const current = prev.length ? prev : allIds;
                            if (current.includes(d.id)) {
                              const next = current.filter((id) => id !== d.id);
                              // Never leave zero selected GPUs when inventory exists.
                              return next.length ? next : allIds;
                            }
                            return [...current, d.id];
                          });
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            (e.currentTarget as HTMLElement).click();
                          }
                        }}
                      >
                        <span className="mono">{d.id}</span>
                        <span>
                          {d.name} · {d.vendor}
                          {d.compute_units != null ? ` · ${d.compute_units} CU` : ""}
                          {d.global_memory_bytes != null
                            ? ` · ${formatBytes(d.global_memory_bytes)}`
                            : ""}
                          {on ? " · selected" : " · click to select"}
                        </span>
                      </li>
                    );
                  })
                ) : (
                  <li>
                    <span>No GPU detected</span>
                    <span>
                      A supported NVIDIA driver and the CUDA-enabled miner sidecar are required.
                    </span>
                  </li>
                )}
              </ul>
              <p className="field-hint">
                Every selected NVIDIA GPU receives an exact, non-overlapping nonce range.
                Eco 40% · Balanced 70% · High 90% · Max 100%.
              </p>
            </article>
          </div>
        </div>
      </Panel>

      <Panel
        title="Miner console"
        detail={
          <span className="console-live">
            <i /> LIVE · {logCadence}s · compact (no TRACE dual panel)
          </span>
        }
        className="console-panel miner-console-panel"
      >
        <div className="console-toolbar">
          <span>
            <Terminal size={14} /> miner.log + miner.err.log
          </span>
          <span>
            <Activity size={14} /> process {n.miner_running ? "active" : "inactive"}
          </span>
          <span>
            <HardDrive size={14} /> {backend} · intensity {gpuIntensity}%
          </span>
          <label className="console-autoscroll">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
            />
            Auto-scroll
          </label>
          <div className="console-actions">
            <button className="button ghost" type="button" onClick={() => void copyConsole()}>
              <Copy size={13} /> Copy
            </button>
            <button className="button ghost" type="button" onClick={() => void exportConsole()}>
              <Download size={13} /> Export
            </button>
          </div>
        </div>
        <pre className="miner-console miner-console-lg" ref={consoleRef}>
          {fullConsole ||
            "Waiting for miner output. Start on Official pool — shares appear as accepted_shares in metrics; full blocks need net difficulty (~minutes)."}
        </pre>
      </Panel>

      <ConfirmDialog
        open={stopOpen}
        title="Stop the miner?"
        description="This stops the local mining process. Work already submitted stays on the gateway; no invented rewards are claimed."
        consequences={[
          "CUDA hashing stops immediately",
          "Hashrate telemetry will drop to idle",
          "Your backend / GPU selections stay saved for the next start"
        ]}
        danger
        confirmLabel="Stop miner"
        onConfirm={confirmStop}
        onClose={() => setStopOpen(false)}
      />
    </div>
  );
}
