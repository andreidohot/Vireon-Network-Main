use crate::secure::{self, DesktopError, WalletMetadata};
use crate::services::{
    self, CreatedWallet, NetworkSnapshot, OperatorCommand, PreparedTransaction, SubmissionResult,
};
use eframe::egui::{self, Color32, FontData, FontDefinitions, FontFamily, RichText, Stroke, Vec2};
use qrcode::{Color as QrColor, QrCode};
use std::sync::mpsc::{self, Receiver, Sender};
use std::time::{Duration, Instant};
use zeroize::Zeroize;

const INK: Color32 = Color32::from_rgb(218, 235, 245);
const TEAL: Color32 = Color32::from_rgb(0, 196, 239);
const CORAL: Color32 = Color32::from_rgb(43, 217, 255);
const CREAM: Color32 = Color32::from_rgb(3, 12, 18);
const PAPER: Color32 = Color32::from_rgb(6, 20, 29);
const PANEL_ALT: Color32 = Color32::from_rgb(8, 27, 38);
const BORDER: Color32 = Color32::from_rgb(23, 61, 78);
const MUTED: Color32 = Color32::from_rgb(123, 149, 164);
const GREEN: Color32 = Color32::from_rgb(82, 211, 126);
const GOLD: Color32 = Color32::from_rgb(225, 176, 91);

#[derive(Clone, Copy, PartialEq, Eq)]
enum Page {
    Overview,
    Wallet,
    Send,
    Mining,
    Explorer,
    Blocks,
    Transactions,
    Node,
    Rewards,
    Assets,
    Settings,
}

enum Event {
    WalletCreated(Result<CreatedWallet, DesktopError>),
    WalletImported(Result<WalletMetadata, DesktopError>),
    Network(Box<Result<NetworkSnapshot, DesktopError>>),
    Prepared(Result<PreparedTransaction, DesktopError>),
    Submitted(Result<SubmissionResult, DesktopError>),
    Operator(Result<String, DesktopError>),
    Logs(Result<String, DesktopError>),
}

pub struct VireonApp {
    page: Page,
    wallet: Option<WalletMetadata>,
    network: NetworkSnapshot,
    workspace: std::path::PathBuf,
    tx: Sender<Event>,
    rx: Receiver<Event>,
    busy: bool,
    notice: Option<(bool, String)>,
    import_phrase: String,
    replace_confirmed: bool,
    recovery_phrase: Option<String>,
    recovery_confirmed: bool,
    recipient: String,
    amount: String,
    tip: String,
    prepared: Option<PreparedTransaction>,
    signing_confirmed: bool,
    operator_output: String,
    operator_mode: bool,
    miner_threads: usize,
    selected_log: String,
    explorer_query: String,
    last_refresh: Instant,
}

impl VireonApp {
    pub fn new(context: &eframe::CreationContext<'_>) -> Self {
        configure_style(&context.egui_ctx);
        let (tx, rx) = mpsc::channel();
        let wallet = secure::load_metadata().unwrap_or(None);
        let mut app = Self {
            page: Page::Overview,
            wallet,
            network: NetworkSnapshot::default(),
            workspace: services::find_workspace_root(),
            tx,
            rx,
            busy: false,
            notice: None,
            import_phrase: String::new(),
            replace_confirmed: false,
            recovery_phrase: None,
            recovery_confirmed: false,
            recipient: String::new(),
            amount: String::new(),
            tip: "0.00000001".to_owned(),
            prepared: None,
            signing_confirmed: false,
            operator_output: String::new(),
            operator_mode: false,
            miner_threads: std::thread::available_parallelism().map_or(1, usize::from),
            selected_log: "node".to_owned(),
            explorer_query: String::new(),
            last_refresh: Instant::now() - Duration::from_secs(30),
        };
        app.refresh(context.egui_ctx.clone());
        app
    }

    fn spawn(&mut self, context: egui::Context, task: impl FnOnce() -> Event + Send + 'static) {
        if self.busy {
            return;
        }
        self.busy = true;
        self.notice = None;
        let sender = self.tx.clone();
        std::thread::spawn(move || {
            let _ = sender.send(task());
            context.request_repaint();
        });
    }

    fn refresh(&mut self, context: egui::Context) {
        self.last_refresh = Instant::now();
        let wallet = self.wallet.clone();
        let workspace = self.workspace.clone();
        self.spawn(context, move || {
            Event::Network(Box::new(services::network_snapshot(
                &workspace,
                wallet.as_ref(),
            )))
        });
    }

    fn events(&mut self) {
        while let Ok(event) = self.rx.try_recv() {
            self.busy = false;
            match event {
                Event::WalletCreated(Ok(created)) => {
                    self.wallet = Some(created.metadata);
                    self.recovery_phrase = Some(created.mnemonic);
                    self.recovery_confirmed = false;
                    self.notice = Some((
                        true,
                        "Wallet secured by Windows Credential Manager.".to_owned(),
                    ));
                }
                Event::WalletImported(Ok(wallet)) => {
                    self.wallet = Some(wallet);
                    self.replace_confirmed = false;
                    self.notice = Some((true, "Wallet imported securely.".to_owned()));
                }
                Event::Network(result) => match *result {
                    Ok(snapshot) => self.network = snapshot,
                    Err(error) => {
                        self.network = NetworkSnapshot {
                            detail: error.to_string(),
                            ..Default::default()
                        };
                    }
                },
                Event::Prepared(Ok(preview)) => {
                    self.prepared = Some(preview);
                    self.signing_confirmed = false;
                }
                Event::Submitted(Ok(result)) => {
                    self.prepared = None;
                    self.signing_confirmed = false;
                    self.notice = Some((
                        true,
                        format!(
                            "Transaction {} is {} (mempool {}).",
                            short(&result.tx_hash),
                            result.lifecycle_status,
                            result.mempool_size
                        ),
                    ));
                }
                Event::Operator(Ok(output)) => {
                    self.operator_output = output;
                    self.notice = Some((true, "Operator command completed.".to_owned()));
                }
                Event::Logs(Ok(output)) => self.operator_output = output,
                Event::WalletCreated(Err(error))
                | Event::WalletImported(Err(error))
                | Event::Prepared(Err(error))
                | Event::Submitted(Err(error))
                | Event::Operator(Err(error))
                | Event::Logs(Err(error)) => {
                    self.notice = Some((false, error.to_string()));
                }
            }
        }
    }

    fn title_bar(&mut self, context: &egui::Context) {
        egui::TopBottomPanel::top("window-title-bar")
            .exact_height(36.0)
            .frame(
                egui::Frame::new()
                    .fill(Color32::from_rgb(1, 8, 13))
                    .stroke(Stroke::new(1.0_f32, BORDER))
                    .inner_margin(egui::Margin::symmetric(14, 5)),
            )
            .show(context, |ui| {
                let drag = ui
                    .horizontal(|ui| {
                        ui.label(RichText::new("V").size(16.0).strong().color(TEAL));
                        ui.label(RichText::new("Vireon.exe").size(12.0).strong().color(INK));
                        ui.label(
                            RichText::new("MAINNET CANDIDATE / PROTOTYPE")
                                .size(9.0)
                                .color(GOLD),
                        );
                        ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                            if ui.button("X").clicked() {
                                context.send_viewport_cmd(egui::ViewportCommand::Close);
                            }
                            if ui.button("[]").clicked() {
                                context.send_viewport_cmd(egui::ViewportCommand::Maximized(true));
                            }
                            if ui.button("-").clicked() {
                                context.send_viewport_cmd(egui::ViewportCommand::Minimized(true));
                            }
                        });
                    })
                    .response;
                if drag.drag_started() {
                    context.send_viewport_cmd(egui::ViewportCommand::StartDrag);
                }
            });
    }

    fn nav(&mut self, context: &egui::Context) {
        egui::SidePanel::left("nav")
            .exact_width(204.0)
            .frame(
                egui::Frame::new()
                    .fill(Color32::from_rgb(2, 11, 17))
                    .stroke(Stroke::new(1.0_f32, BORDER))
                    .inner_margin(egui::Margin::symmetric(14, 18)),
            )
            .show(context, |ui| {
                ui.vertical_centered(|ui| {
                    ui.add_space(6.0);
                    let (rect, _) =
                        ui.allocate_exact_size(Vec2::splat(118.0), egui::Sense::hover());
                    let painter = ui.painter();
                    painter.circle_filled(rect.center(), 55.0, Color32::from_rgb(3, 30, 43));
                    painter.circle_stroke(rect.center(), 53.0, Stroke::new(1.5_f32, TEAL));
                    painter.circle_stroke(rect.center(), 44.0, Stroke::new(1.0_f32, BORDER));
                    painter.text(
                        rect.center(),
                        egui::Align2::CENTER_CENTER,
                        "V",
                        egui::FontId::proportional(62.0),
                        GOLD,
                    );
                    ui.label(RichText::new("VIREON").size(22.0).strong().color(TEAL));
                    ui.label(
                        RichText::new("CONTROL CENTER")
                            .size(9.0)
                            .strong()
                            .color(MUTED),
                    );
                });
                ui.add_space(22.0);
                nav_button(ui, &mut self.page, Page::Overview, "01", "OVERVIEW");
                nav_button(ui, &mut self.page, Page::Wallet, "02", "WALLET");
                nav_button(ui, &mut self.page, Page::Send, "03", "SEND & RECEIVE");
                nav_button(ui, &mut self.page, Page::Mining, "04", "MINER");
                nav_button(ui, &mut self.page, Page::Explorer, "05", "EXPLORER");
                nav_button(ui, &mut self.page, Page::Blocks, "06", "BLOCKS");
                nav_button(ui, &mut self.page, Page::Transactions, "07", "TRANSACTIONS");
                nav_button(ui, &mut self.page, Page::Node, "08", "NODES");
                nav_button(ui, &mut self.page, Page::Rewards, "09", "REWARDS");
                nav_button(ui, &mut self.page, Page::Assets, "10", "ASSETS");
                nav_button(ui, &mut self.page, Page::Settings, "11", "SETTINGS");
                ui.with_layout(egui::Layout::bottom_up(egui::Align::LEFT), |ui| {
                    panel(ui, |ui| {
                        status_line(ui, "VIREON CORE", self.network.node_running);
                        ui.label(RichText::new("Mainnet Candidate").size(10.0).color(GOLD));
                        ui.label(RichText::new("NOT PUBLIC MAINNET").size(9.0).color(MUTED));
                    });
                });
            });
    }

    fn header(&mut self, ui: &mut egui::Ui, context: &egui::Context, title: &str, label: &str) {
        ui.horizontal(|ui| {
            ui.vertical(|ui| {
                ui.label(
                    RichText::new(label.to_uppercase())
                        .size(9.0)
                        .strong()
                        .color(MUTED),
                );
                ui.label(
                    RichText::new(title.to_uppercase())
                        .size(29.0)
                        .strong()
                        .color(INK),
                );
            });
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                if ui
                    .add_enabled(!self.busy, egui::Button::new("REFRESH"))
                    .clicked()
                {
                    self.refresh(context.clone());
                }
                pill(ui, self.network.online);
                badge(ui, "MAINNET CANDIDATE", GOLD);
                ui.add_enabled(false, egui::Button::new("TESTNET"));
                ui.add_enabled(false, egui::Button::new("DEVNET"));
            });
        });
        ui.add_space(12.0);
        if let Some((ok, message)) = &self.notice {
            let color = if *ok { TEAL } else { CORAL };
            egui::Frame::new()
                .fill(color.gamma_multiply(0.09))
                .stroke(Stroke::new(1.0_f32, color.gamma_multiply(0.5)))
                .corner_radius(8)
                .inner_margin(egui::Margin::same(12))
                .show(ui, |ui| {
                    ui.label(RichText::new(message).color(color));
                });
            ui.add_space(12.0);
        }
    }

    fn overview(&mut self, ui: &mut egui::Ui, context: &egui::Context) {
        self.header(ui, context, "Overview", "Vireon Windows control panel");

        ui.columns(4, |columns| {
            dashboard_metric(
                &mut columns[0],
                "TOTAL VIRE BALANCE",
                self.network
                    .balance_atomic
                    .map(services::format_atomic)
                    .unwrap_or_else(|| "--".into()),
                "VIRE available",
                GOLD,
            );
            dashboard_wallet(&mut columns[1], self.wallet.as_ref());
            dashboard_metric(
                &mut columns[2],
                "MINING STATUS",
                if self.network.miner_running {
                    "MINING".into()
                } else {
                    "STOPPED".into()
                },
                &format!(
                    "{} worker threads",
                    self.network.miner_threads.unwrap_or_default()
                ),
                if self.network.miner_running {
                    GREEN
                } else {
                    MUTED
                },
            );
            dashboard_hashrate(&mut columns[3], self.network.miner_hashrate_hs);
        });
        ui.add_space(10.0);

        ui.columns(3, |columns| {
            dashboard_chain(&mut columns[0], &self.network);
            dashboard_activity(&mut columns[1], &self.network);
            dashboard_health(&mut columns[2], &self.network);
        });
        ui.add_space(10.0);

        ui.columns(3, |columns| {
            dashboard_supply(&mut columns[0], &self.network);
            dashboard_network(&mut columns[1], &self.network);
            panel(&mut columns[2], |ui| {
                section_title(ui, "QUICK ACTIONS", "LOCAL OPERATIONS");
                ui.columns(2, |actions| {
                    if quick_action(&mut actions[0], "⇄", "SEND VIRE") {
                        self.page = Page::Send;
                    }
                    if quick_action(&mut actions[1], "▣", "WALLET") {
                        self.page = Page::Wallet;
                    }
                    if quick_action(&mut actions[0], "⚒", "MINER") {
                        self.page = Page::Mining;
                    }
                    if quick_action(&mut actions[1], "⌕", "EXPLORER") {
                        self.page = Page::Explorer;
                    }
                    if quick_action(&mut actions[0], "◇", "NODE") {
                        self.page = Page::Node;
                    }
                    if quick_action(&mut actions[1], "⚙", "SECURITY") {
                        self.page = Page::Settings;
                    }
                });
            });
        });
    }

    fn wallet(&mut self, ui: &mut egui::Ui, context: &egui::Context) {
        self.header(
            ui,
            context,
            "Wallet Center",
            "Address, balance and local signing",
        );
        let wallet = self.wallet.clone();
        ui.columns(3, |columns| {
            panel(&mut columns[0], |ui| {
                section_title(ui, "TOTAL VIRE BALANCE", "ACTIVE DESKTOP WALLET");
                ui.label(
                    RichText::new(
                        self.network
                            .balance_atomic
                            .map(services::format_atomic)
                            .unwrap_or_else(|| "--".to_owned()),
                    )
                    .size(32.0)
                    .strong()
                    .color(GOLD),
                );
                ui.label(RichText::new("VIRE").size(12.0).color(INK));
                sparkline(ui, self.network.balance_atomic.unwrap_or_default() as f64);
                ui.horizontal(|ui| {
                    if ui.button("SEND VIRE").clicked() {
                        self.page = Page::Send;
                    }
                    if ui.button("REFRESH BALANCE").clicked() {
                        self.refresh(context.clone());
                    }
                });
            });
            panel(&mut columns[1], |ui| {
                section_title(ui, "WALLET IDENTITY", "WINDOWS USER-BOUND");
                if let Some(wallet) = wallet.as_ref() {
                    row(ui, "Address", &short(&wallet.address));
                    row(ui, "Network", "Mainnet Candidate");
                    row(ui, "Derivation", &wallet.derivation_path);
                    row(ui, "Protection", "Windows Credential Manager");
                    if ui.button("COPY FULL ADDRESS").clicked() {
                        ui.ctx().copy_text(wallet.address.clone());
                    }
                } else {
                    empty_state(ui, "No wallet configured for this Windows user.");
                    if ui.button("OPEN WALLET SETUP").clicked() {
                        self.page = Page::Settings;
                    }
                }
            });
            panel(&mut columns[2], |ui| {
                section_title(ui, "RECEIVE VIRE", "LOCAL ADDRESS QR");
                if let Some(wallet) = wallet.as_ref() {
                    draw_qr(ui, &wallet.address, 148.0);
                    ui.label(RichText::new(short(&wallet.address)).size(9.0).color(MUTED));
                    if ui.button("COPY ADDRESS").clicked() {
                        ui.ctx().copy_text(wallet.address.clone());
                    }
                } else {
                    empty_state(ui, "Create a wallet to generate a receive code.");
                }
            });
        });
        ui.add_space(12.0);
        ui.columns(2, |columns| {
            panel(&mut columns[0], |ui| {
                section_title(ui, "RECENT WALLET ACTIVITY", "INDEXED TRANSACTIONS");
                let address = wallet.as_ref().map(|wallet| wallet.address.as_str());
                let mut shown = 0;
                for transaction in self.network.recent_transactions.iter().filter(|transaction| {
                    address.is_some_and(|address| transaction.from.as_deref() == Some(address) || transaction.to == address)
                }).take(6) {
                    let incoming = address.is_some_and(|address| transaction.to == address);
                    compact_row(
                        ui,
                        if incoming { "RECEIVED" } else { "SENT" },
                        &format!("{}{} VIRE", if incoming { "+" } else { "-" }, services::format_atomic(transaction.amount_atomic)),
                        if incoming { GREEN } else { CORAL },
                    );
                    shown += 1;
                }
                if shown == 0 {
                    empty_state(ui, "No indexed activity for the active wallet.");
                }
            });
            panel(&mut columns[1], |ui| {
                section_title(ui, "SECURITY BOUNDARY", "LOCAL SIGNING ONLY");
                status_line(ui, "PRIVATE KEY PROTECTED", wallet.is_some());
                status_line(ui, "LOCALHOST RPC", self.network.online);
                status_line(ui, "CHAIN INDEX", self.network.indexer_ready);
                ui.separator();
                ui.label(RichText::new("The private key is never displayed or sent to RPC. Recovery phrases are shown once and are not persisted by the app.").size(10.0).color(MUTED));
            });
        });
    }

    fn send(&mut self, ui: &mut egui::Ui, context: &egui::Context) {
        self.header(
            ui,
            context,
            "Review before signing",
            "Direct localhost submission",
        );
        let Some(wallet) = self.wallet.clone() else {
            card(ui, |ui| {
                ui.label("Create or import a secured wallet first.");
            });
            return;
        };
        if let Some(preview) = self.prepared.clone() {
            card(ui, |ui| {
                ui.label(
                    RichText::new("EXACT SIGNING PREVIEW")
                        .size(11.0)
                        .strong()
                        .color(CORAL),
                );
                row(ui, "Recipient", &preview.recipient);
                row(
                    ui,
                    "Amount",
                    &format!("{} VIRE", services::format_atomic(preview.amount_atomic)),
                );
                row(
                    ui,
                    "Base fee burned",
                    &format!("{} VIRE", services::format_atomic(preview.base_fee_atomic)),
                );
                row(
                    ui,
                    "Priority tip",
                    &format!("{} VIRE", services::format_atomic(preview.tip_atomic)),
                );
                row(
                    ui,
                    "Total debit",
                    &format!("{} VIRE", services::format_atomic(preview.total_atomic)),
                );
                row(
                    ui,
                    "Available",
                    &format!("{} VIRE", services::format_atomic(preview.available_atomic)),
                );
                row(ui, "Account nonce", &preview.nonce.to_string());
                ui.checkbox(
                    &mut self.signing_confirmed,
                    "I verified every value and the Mainnet Candidate warning.",
                );
                ui.horizontal(|ui| {
                    if ui.button("Cancel").clicked() {
                        self.prepared = None;
                    }
                    if ui
                        .add_enabled(
                            self.signing_confirmed && !self.busy,
                            egui::Button::new("Sign + submit to localhost"),
                        )
                        .clicked()
                    {
                        let workspace = self.workspace.clone();
                        self.spawn(context.clone(), move || {
                            Event::Submitted(services::sign_and_submit(
                                &workspace, &wallet, &preview,
                            ))
                        });
                    }
                });
            });
            return;
        }
        card(ui, |ui| {
            ui.label(
                RichText::new("NEW TRANSFER")
                    .size(11.0)
                    .strong()
                    .color(CORAL),
            );
            field(ui, "Recipient address", &mut self.recipient, false);
            field(ui, "Amount (VIRE)", &mut self.amount, false);
            field(ui, "Priority tip (VIRE)", &mut self.tip, false);
            ui.label(RichText::new("The current base fee is added automatically. Nothing is signed before confirmation.").color(MUTED));
            if ui
                .add_enabled(!self.busy, egui::Button::new("Build exact preview"))
                .clicked()
            {
                let workspace = self.workspace.clone();
                let recipient = self.recipient.trim().to_owned();
                let amount = self.amount.trim().to_owned();
                let tip = self.tip.trim().to_owned();
                let signing_wallet = wallet.clone();
                self.spawn(context.clone(), move || {
                    Event::Prepared(services::prepare_transaction(
                        &workspace,
                        &signing_wallet,
                        &recipient,
                        &amount,
                        &tip,
                    ))
                });
            }
        });
        ui.add_space(12.0);
        panel(ui, |ui| {
            section_title(ui, "RECEIVE VIRE", "ACTIVE WALLET ADDRESS");
            ui.horizontal(|ui| {
                draw_qr(ui, &wallet.address, 118.0);
                ui.vertical(|ui| {
                    row(ui, "Network", "Vireon Mainnet Candidate");
                    ui.label(RichText::new(&wallet.address).size(10.0).color(INK));
                    if ui.button("COPY RECEIVE ADDRESS").clicked() {
                        ui.ctx().copy_text(wallet.address.clone());
                    }
                    ui.label(RichText::new("This QR contains only the public address. Verify the network and address before use.").size(9.0).color(MUTED));
                });
            });
        });
    }

    fn run_control(&mut self, context: &egui::Context, command: OperatorCommand) {
        let workspace = self.workspace.clone();
        let address = self.wallet.as_ref().map(|wallet| wallet.address.clone());
        let threads = self.miner_threads;
        self.spawn(context.clone(), move || {
            Event::Operator(services::run_operator(
                &workspace,
                command,
                address.as_deref(),
                threads,
            ))
        });
    }

    fn mining(&mut self, ui: &mut egui::Ui, context: &egui::Context) {
        self.header(ui, context, "Mining", "Standalone Blake3 CPU miner");
        ui.columns(3, |columns| {
            metric(
                &mut columns[0],
                "HASHRATE",
                self.network
                    .miner_hashrate_hs
                    .map(format_hashrate)
                    .unwrap_or_else(|| "--".to_owned()),
                &format!(
                    "{} active threads",
                    self.network.miner_threads.unwrap_or(self.miner_threads)
                ),
            );
            metric(
                &mut columns[1],
                "WORK HEIGHT",
                self.network
                    .miner_height
                    .map(|value| value.to_string())
                    .unwrap_or_else(|| "--".to_owned()),
                "current template",
            );
            metric(
                &mut columns[2],
                "ACCEPTED",
                self.network
                    .miner_accepted_blocks
                    .unwrap_or_default()
                    .to_string(),
                "blocks this miner session",
            );
        });
        ui.add_space(16.0);
        card(ui, |ui| {
            ui.label(
                RichText::new("MINER CONTROL")
                    .size(11.0)
                    .strong()
                    .color(CORAL),
            );
            if let Some(wallet) = &self.wallet {
                row(ui, "Reward address", &wallet.address);
            } else {
                ui.colored_label(CORAL, "Create or import a wallet before mining.");
            }
            ui.horizontal(|ui| {
                ui.label("CPU threads");
                ui.add(egui::DragValue::new(&mut self.miner_threads).range(1..=256));
            });
            ui.label("Mining requires the local node and RPC. Rewards are paid only to the displayed wallet address.");
            ui.horizontal(|ui| {
                if ui
                    .add_enabled(
                        !self.busy && self.wallet.is_some() && !self.network.miner_running,
                        egui::Button::new("Start miner"),
                    )
                    .clicked()
                {
                    self.run_control(context, OperatorCommand::StartMiner);
                }
                if ui
                    .add_enabled(
                        !self.busy && self.network.miner_running,
                        egui::Button::new("Stop miner"),
                    )
                    .clicked()
                {
                    self.run_control(context, OperatorCommand::StopMiner);
                }
                if ui
                    .add_enabled(
                        !self.busy && self.wallet.is_some(),
                        egui::Button::new("Mine one block"),
                    )
                    .clicked()
                {
                    self.run_control(context, OperatorCommand::Mine);
                }
            });
        });
        ui.add_space(12.0);
        ui.columns(2, |columns| {
            panel(&mut columns[0], |ui| {
                section_title(ui, "HASHRATE TELEMETRY", "CURRENT MINER SESSION");
                sparkline(ui, self.network.miner_hashrate_hs.unwrap_or_default());
                compact_row(ui, "ALGORITHM", "BLAKE3 POW", TEAL);
                compact_row(ui, "MODE", "SOLO / LOCAL NODE", GREEN);
                compact_row(ui, "POOL MINING", "NOT IMPLEMENTED", GOLD);
            });
            panel(&mut columns[1], |ui| {
                section_title(ui, "HARDWARE VISIBILITY", "SAFE LOCAL METRICS");
                compact_row(
                    ui,
                    "CPU WORKERS",
                    &self.network.miner_threads.unwrap_or(self.miner_threads).to_string(),
                    INK,
                );
                compact_row(ui, "GPU WORKERS", "UNAVAILABLE", MUTED);
                compact_row(ui, "TEMPERATURE", "UNAVAILABLE", MUTED);
                compact_row(ui, "POWER / FAN", "UNAVAILABLE", MUTED);
                ui.label(RichText::new("The miner does not yet expose trusted hardware sensors, share accounting or pool telemetry. Values are not simulated.").size(9.0).color(MUTED));
            });
        });
    }

    fn node(&mut self, ui: &mut egui::Ui, context: &egui::Context) {
        self.header(
            ui,
            context,
            "Node control",
            "Full-node validation and local services",
        );
        ui.columns(3, |columns| {
            dashboard_metric(
                &mut columns[0],
                "FULL VALIDATOR",
                if self.network.node_running {
                    "ACTIVE".to_owned()
                } else {
                    "INACTIVE".to_owned()
                },
                "independent PoW chain validation",
                if self.network.node_running {
                    GREEN
                } else {
                    CORAL
                },
            );
            dashboard_metric(
                &mut columns[1],
                "P2P IDENTITY",
                self.network
                    .local_peer_id
                    .as_deref()
                    .map(short)
                    .unwrap_or_else(|| "OFFLINE".to_owned()),
                "Noise-encrypted node identity",
                TEAL,
            );
            dashboard_metric(
                &mut columns[2],
                "CHAIN HEIGHT",
                display_u64(self.network.height),
                "locally validated state",
                GOLD,
            );
        });
        ui.add_space(14.0);
        card(ui, |ui| {
            ui.label(
                RichText::new("CONTROL SURFACE")
                    .size(11.0)
                    .strong()
                    .color(CORAL),
            );
            ui.label(
                RichText::new(format!("Workspace: {}", self.workspace.display())).color(MUTED),
            );
            ui.checkbox(
                &mut self.operator_mode,
                "Enable operator controls for this session",
            );
            ui.label(RichText::new("Vireon uses PoW: every full node has equal validation authority. No stake, license, account flag or central permission is required. Mining proposes blocks; full validators independently accept or reject them by consensus rules.").color(MUTED));
            ui.separator();
            compact_row(
                ui,
                "LOCAL PEER ID",
                self.network
                    .local_peer_id
                    .as_deref()
                    .unwrap_or("P2P offline"),
                TEAL,
            );
            compact_row(
                ui,
                "CONNECTED / VALIDATED",
                &format!(
                    "{} / {}",
                    self.network.connected_peer_count, self.network.validated_peer_count
                ),
                INK,
            );
            compact_row(
                ui,
                "VALIDATING / MINING PEERS",
                &format!(
                    "{} / {}",
                    self.network.validating_peer_count, self.network.mining_peer_count
                ),
                INK,
            );
            compact_row(
                ui,
                "CHAIN SYNC",
                if self.network.p2p_syncing {
                    "SYNCING"
                } else {
                    "IDLE"
                },
                if self.network.p2p_syncing {
                    GOLD
                } else {
                    GREEN
                },
            );
            if let Some(address) = self.network.p2p_listen_addresses.first() {
                compact_row(ui, "LISTEN ADDRESS", address, MUTED);
            }
            if let Some(error) = &self.network.p2p_error {
                ui.label(
                    RichText::new(format!("P2P: {error}"))
                        .size(9.0)
                        .color(CORAL),
                );
            }
            ui.horizontal_wrapped(|ui| {
                for (label, command) in [
                    ("Start stack", OperatorCommand::Start),
                    ("Restart stack", OperatorCommand::Restart),
                    ("Status", OperatorCommand::Status),
                    ("Validate chain", OperatorCommand::Validate),
                    ("Backup", OperatorCommand::Backup),
                    ("Stop stack", OperatorCommand::Stop),
                ] {
                    if ui
                        .add_enabled(!self.busy && self.operator_mode, egui::Button::new(label))
                        .clicked()
                    {
                        self.run_control(context, command);
                    }
                }
            });
        });
        ui.add_space(14.0);
        panel(ui, |ui| {
            section_title(ui, "CONNECTED PEERS", "LOCAL NODE VIEW");
            table_header(
                ui,
                &[
                    "PEER ID",
                    "ADDRESS",
                    "HEIGHT",
                    "ROLE",
                    "HANDSHAKE",
                    "STATUS",
                ],
            );
            if self.network.peers.is_empty() {
                empty_state(ui, "No connected peers. Public seed discovery is not configured in this candidate.");
            }
            for peer in &self.network.peers {
                let role = match (peer.validating, peer.mining) {
                    (true, true) => "VALIDATING / MINING",
                    (true, false) => "VALIDATING",
                    (false, true) => "MINING",
                    (false, false) => "CONNECTED",
                };
                ui.columns(6, |columns| {
                    table_cell(&mut columns[0], &short(&peer.peer_id), TEAL);
                    table_cell(
                        &mut columns[1],
                        peer.address.as_deref().unwrap_or("--"),
                        MUTED,
                    );
                    table_cell(&mut columns[2], &display_u64(peer.best_height), INK);
                    table_cell(&mut columns[3], role, INK);
                    table_cell(
                        &mut columns[4],
                        if peer.handshake_validated {
                            "VALID"
                        } else {
                            "PENDING"
                        },
                        if peer.handshake_validated {
                            GREEN
                        } else {
                            GOLD
                        },
                    );
                    table_cell(
                        &mut columns[5],
                        peer.last_error.as_deref().unwrap_or("HEALTHY"),
                        if peer.last_error.is_some() {
                            CORAL
                        } else {
                            GREEN
                        },
                    );
                });
                ui.separator();
            }
        });
        ui.add_space(14.0);
        card(ui, |ui| {
            ui.label(
                RichText::new("LATEST OPERATOR OUTPUT")
                    .size(11.0)
                    .strong()
                    .color(CORAL),
            );
            ui.horizontal(|ui| {
                egui::ComboBox::from_id_salt("log-service")
                    .selected_text(&self.selected_log)
                    .show_ui(ui, |ui| {
                        for service in ["node", "rpc", "miner", "explorer"] {
                            ui.selectable_value(
                                &mut self.selected_log,
                                service.to_owned(),
                                service,
                            );
                        }
                    });
                if ui.button("Load logs").clicked() {
                    let workspace = self.workspace.clone();
                    let service = self.selected_log.clone();
                    self.spawn(context.clone(), move || {
                        Event::Logs(services::recent_logs(&workspace, &service, 120))
                    });
                }
            });
            egui::ScrollArea::vertical()
                .max_height(330.0)
                .show(ui, |ui| {
                    ui.add(
                        egui::TextEdit::multiline(&mut self.operator_output)
                            .font(egui::TextStyle::Monospace)
                            .desired_width(f32::INFINITY)
                            .interactive(false),
                    );
                });
        });
    }

    fn explorer(&mut self, ui: &mut egui::Ui, context: &egui::Context) {
        self.header(ui, context, "Explorer", "Chain visibility");
        panel(ui, |ui| {
            section_title(ui, "EXPLORER SEARCH", "LOCAL INDEX / RPC");
            ui.horizontal(|ui| {
                ui.add(
                    egui::TextEdit::singleline(&mut self.explorer_query)
                        .hint_text("Block height, transaction hash, or vire address")
                        .desired_width(ui.available_width() - 90.0),
                );
                if ui.button("SEARCH").clicked() {
                    let query = self.explorer_query.trim();
                    let path = if query.starts_with("vire1") {
                        format!("addresses/{query}")
                    } else if query.parse::<u64>().is_ok() {
                        format!("blocks/{query}")
                    } else {
                        format!("transactions/{query}")
                    };
                    if let Err(error) = services::open_explorer_path(&path) {
                        self.notice = Some((false, error.to_string()));
                    }
                }
            });
        });
        ui.add_space(12.0);
        ui.columns(3, |columns| {
            metric(
                &mut columns[0],
                "HEIGHT",
                self.network
                    .height
                    .map(|v| v.to_string())
                    .unwrap_or_else(|| "--".to_owned()),
                "validated chain",
            );
            metric(
                &mut columns[1],
                "INDEXED",
                self.network
                    .indexed_height
                    .map(|v| v.to_string())
                    .unwrap_or_else(|| "--".to_owned()),
                &format!("{} indexed blocks", self.network.indexed_blocks),
            );
            metric(
                &mut columns[2],
                "SUPPLY",
                self.network
                    .emitted_supply_atomic
                    .map(services::format_atomic)
                    .unwrap_or_else(|| "--".to_owned()),
                &format!(
                    "of {} VIRE",
                    self.network
                        .max_supply_atomic
                        .map(services::format_atomic)
                        .unwrap_or_else(|| "--".to_owned())
                ),
            );
        });
        ui.add_space(16.0);
        card(ui, |ui| {
            row(
                ui,
                "Tip hash",
                self.network.tip_hash.as_deref().unwrap_or("--"),
            );
            row(
                ui,
                "Mempool",
                &format!("{} pending transactions", self.network.mempool_count),
            );
            row(
                ui,
                "Indexer",
                if self.network.indexer_ready {
                    "ready"
                } else {
                    "offline or behind"
                },
            );
            if ui.button("Open full explorer in browser").clicked() {
                match services::open_explorer() {
                    Ok(()) => {
                        self.notice =
                            Some((true, "Explorer opened in the default browser.".to_owned()))
                    }
                    Err(error) => self.notice = Some((false, error.to_string())),
                }
            }
        });
    }

    fn blocks(&mut self, ui: &mut egui::Ui, context: &egui::Context) {
        self.header(ui, context, "Blocks", "Validated block history");
        ui.columns(3, |columns| {
            metric(
                &mut columns[0],
                "CHAIN HEIGHT",
                display_u64(self.network.height),
                "local validated tip",
            );
            metric(
                &mut columns[1],
                "INDEXED BLOCKS",
                self.network.indexed_blocks.to_string(),
                "local index snapshot",
            );
            metric(
                &mut columns[2],
                "TARGET BLOCK TIME",
                "60 sec".to_owned(),
                "protocol parameter",
            );
        });
        ui.add_space(12.0);
        panel(ui, |ui| {
            section_title(ui, "LATEST BLOCKS", "REAL LOCAL INDEX DATA");
            table_header(ui, &["HEIGHT", "HASH", "TXS", "REWARD", "FEES", "POW"]);
            if self.network.recent_blocks.is_empty() {
                empty_state(
                    ui,
                    "No indexed blocks are available. Start the stack and refresh the index.",
                );
            }
            for block in &self.network.recent_blocks {
                ui.columns(6, |columns| {
                    table_cell(&mut columns[0], &block.height.to_string(), TEAL);
                    table_cell(&mut columns[1], &short(&block.hash), INK);
                    table_cell(&mut columns[2], &block.transaction_count.to_string(), INK);
                    table_cell(
                        &mut columns[3],
                        &format!(
                            "{} VIRE",
                            services::format_atomic(block.miner_reward_atomic)
                        ),
                        GOLD,
                    );
                    table_cell(
                        &mut columns[4],
                        &services::format_atomic(block.fees_atomic),
                        INK,
                    );
                    table_cell(
                        &mut columns[5],
                        &format!("{} bits", block.difficulty_leading_zero_bits),
                        GREEN,
                    );
                });
                ui.separator();
            }
        });
        if let Some(block) = self.network.recent_blocks.first() {
            ui.add_space(12.0);
            panel(ui, |ui| {
                section_title(ui, "LATEST BLOCK DETAILS", "CONSENSUS FIELDS");
                row(ui, "Hash", &block.hash);
                row(ui, "Previous hash", &block.previous_hash);
                row(ui, "Merkle root", &block.merkle_root);
                row(ui, "Miner", &block.miner_address);
                row(ui, "Timestamp", &block.timestamp.to_string());
                row(ui, "Nonce", &block.nonce.to_string());
                row(
                    ui,
                    "Coinbase payout",
                    &format!(
                        "{} VIRE",
                        services::format_atomic(block.coinbase_payout_atomic)
                    ),
                );
                row(
                    ui,
                    "Base fee",
                    &format!("{} VIRE", services::format_atomic(block.base_fee_atomic)),
                );
                row(
                    ui,
                    "Transaction hashes",
                    &block.transaction_hashes.len().to_string(),
                );
            });
        }
    }

    fn transactions(&mut self, ui: &mut egui::Ui, context: &egui::Context) {
        self.header(ui, context, "Transactions", "Signed transfer activity");
        ui.columns(3, |columns| {
            metric(
                &mut columns[0],
                "INDEXED",
                self.network.indexed_transactions.to_string(),
                "mined transactions",
            );
            metric(
                &mut columns[1],
                "MEMPOOL",
                self.network.mempool_count.to_string(),
                "pending transactions",
            );
            metric(
                &mut columns[2],
                "AUTHORIZATION",
                "ED25519".to_owned(),
                "veiron-tx-ed25519-v1",
            );
        });
        ui.add_space(12.0);
        panel(ui, |ui| {
            section_title(ui, "LATEST MINED TRANSACTIONS", "LOCAL INDEX");
            table_header(
                ui,
                &[
                    "TXID", "BLOCK", "FROM", "TO", "AMOUNT", "FEE", "AUTH", "STATUS",
                ],
            );
            if self.network.recent_transactions.is_empty() {
                empty_state(ui, "No indexed transactions are available.");
            }
            for transaction in &self.network.recent_transactions {
                ui.columns(8, |columns| {
                    table_cell(&mut columns[0], &short(&transaction.hash), TEAL);
                    table_cell(&mut columns[1], &transaction.block_height.to_string(), INK);
                    table_cell(
                        &mut columns[2],
                        &transaction
                            .from
                            .as_deref()
                            .map(short)
                            .unwrap_or_else(|| "COINBASE".to_owned()),
                        MUTED,
                    );
                    table_cell(&mut columns[3], &short(&transaction.to), INK);
                    table_cell(
                        &mut columns[4],
                        &format!(
                            "{} VIRE",
                            services::format_atomic(transaction.amount_atomic)
                        ),
                        GOLD,
                    );
                    table_cell(
                        &mut columns[5],
                        &services::format_atomic(transaction.effective_fee_atomic),
                        INK,
                    );
                    table_cell(&mut columns[6], &transaction.authorization_state, TEAL);
                    table_cell(&mut columns[7], &transaction.lifecycle_status, GREEN);
                });
                ui.separator();
            }
            if let Some(transaction) = self.network.recent_transactions.first() {
                ui.add_space(8.0);
                compact_row(ui, "LATEST NONCE", &transaction.nonce.to_string(), INK);
                compact_row(
                    ui,
                    "BASE FEE BURNED",
                    &format!(
                        "{} VIRE",
                        services::format_atomic(transaction.burned_fee_atomic)
                    ),
                    CORAL,
                );
                compact_row(
                    ui,
                    "MINER PRIORITY FEE",
                    &format!(
                        "{} VIRE",
                        services::format_atomic(transaction.effective_priority_fee_atomic)
                    ),
                    GREEN,
                );
            }
        });
    }

    fn rewards(&mut self, ui: &mut egui::Ui, context: &egui::Context) {
        self.header(ui, context, "Rewards", "Local mining analytics");
        let rewards = self
            .network
            .recent_blocks
            .iter()
            .map(|block| block.miner_reward_atomic)
            .sum::<u64>();
        let tips = self
            .network
            .recent_blocks
            .iter()
            .map(|block| block.priority_fees_atomic)
            .sum::<u64>();
        let burned = self
            .network
            .recent_blocks
            .iter()
            .map(|block| block.burned_fees_atomic)
            .sum::<u64>();
        ui.columns(4, |columns| {
            dashboard_metric(
                &mut columns[0],
                "INDEXED REWARDS",
                services::format_atomic(rewards),
                "VIRE in visible blocks",
                GOLD,
            );
            dashboard_metric(
                &mut columns[1],
                "PRIORITY FEES",
                services::format_atomic(tips),
                "credited to miners",
                GREEN,
            );
            dashboard_metric(
                &mut columns[2],
                "BASE FEES BURNED",
                services::format_atomic(burned),
                "removed from circulation",
                CORAL,
            );
            dashboard_hashrate(&mut columns[3], self.network.miner_hashrate_hs);
        });
        ui.add_space(12.0);
        panel(ui, |ui| {
            section_title(ui, "REWARD HISTORY", "LATEST INDEXED BLOCK WINDOW");
            if self.network.recent_blocks.is_empty() {
                empty_state(
                    ui,
                    "Mining reward history will appear after blocks are indexed.",
                );
            }
            for block in &self.network.recent_blocks {
                compact_row(
                    ui,
                    &format!("BLOCK {}", block.height),
                    &format!(
                        "{} VIRE",
                        services::format_atomic(block.miner_reward_atomic)
                    ),
                    GOLD,
                );
            }
            ui.separator();
            ui.label(RichText::new("Profitability and fiat estimates are unavailable because no trusted market or hardware-energy feed is configured.").size(10.0).color(MUTED));
        });
    }

    fn assets(&mut self, ui: &mut egui::Ui, context: &egui::Context) {
        self.header(ui, context, "Assets", "Digital ownership roadmap");
        panel(ui, |ui| {
            section_title(ui, "ASSET CAPABILITIES", "PLANNED / NOT ACTIVE");
            ui.label(RichText::new("Only native VIRE transfers are implemented in the current Mainnet Candidate. The modules below are protocol and product directions, not live assets.").color(GOLD));
        });
        ui.add_space(12.0);
        ui.columns(3, |columns| {
            planned_card(
                &mut columns[0],
                "NATIVE ASSETS",
                "VRC-20 direction",
                "Planned",
            );
            planned_card(
                &mut columns[1],
                "NFT RECORDS",
                "VRC-721 / VRC-1155 direction",
                "Research",
            );
            planned_card(
                &mut columns[2],
                "SOFTWARE LICENSES",
                "VRC-LICENSE proof direction",
                "Planned",
            );
        });
        ui.add_space(10.0);
        ui.columns(3, |columns| {
            planned_card(
                &mut columns[0],
                "VIREON PASSPORT",
                "Selective identity proofs",
                "Planned",
            );
            planned_card(
                &mut columns[1],
                "FILES & PROOFS",
                "Hashes on-chain; payloads off-chain",
                "Research",
            );
            planned_card(
                &mut columns[2],
                "MARKETPLACE",
                "Settlement layer",
                "Coming Soon",
            );
        });
    }

    fn settings(&mut self, ui: &mut egui::Ui, context: &egui::Context) {
        self.header(
            ui,
            context,
            "Settings & Security",
            "Application, network and wallet protection",
        );
        ui.columns(3, |columns| {
            planned_card(
                &mut columns[0],
                "ACTIVE NETWORK",
                "Vireon Mainnet Candidate",
                "Locked",
            );
            planned_card(
                &mut columns[1],
                "RPC ENDPOINT",
                services::RPC_URL,
                "Localhost only",
            );
            planned_card(
                &mut columns[2],
                "AUTO UPDATE",
                "Signed release channel required",
                "Planned",
            );
        });
        ui.add_space(14.0);
        if let Some(phrase) = self.recovery_phrase.clone() {
            card(ui, |ui| {
                ui.label(
                    RichText::new("RECOVERY PHRASE / SHOWN ONCE")
                        .size(11.0)
                        .strong()
                        .color(CORAL),
                );
                ui.label(RichText::new(phrase).size(18.0).strong().color(INK));
                ui.label(RichText::new("Record offline. Never paste into chat, logs, source files, screenshots, or cloud notes.").color(CORAL));
                ui.checkbox(
                    &mut self.recovery_confirmed,
                    "I recorded it offline and understand it cannot be shown again.",
                );
                if ui
                    .add_enabled(
                        self.recovery_confirmed,
                        egui::Button::new("Hide permanently"),
                    )
                    .clicked()
                {
                    if let Some(mut value) = self.recovery_phrase.take() {
                        value.zeroize();
                    }
                }
            });
            ui.add_space(14.0);
        }
        card(ui, |ui| {
            ui.label(
                RichText::new("CREATE 24-WORD WALLET")
                    .size(11.0)
                    .strong()
                    .color(CORAL),
            );
            ui.label("Uses BIP39 plus SLIP-0010 at m/44'/7330'/0'/0'/0'. The phrase is not written by this app.");
            if self.wallet.is_some() {
                ui.checkbox(
                    &mut self.replace_confirmed,
                    "Replace the current desktop wallet.",
                );
            }
            if ui
                .add_enabled(
                    (self.wallet.is_none() || self.replace_confirmed) && !self.busy,
                    egui::Button::new("Create secured wallet"),
                )
                .clicked()
            {
                self.spawn(context.clone(), move || {
                    Event::WalletCreated(services::create_wallet())
                });
            }
        });
        ui.add_space(14.0);
        card(ui, |ui| {
            ui.label(
                RichText::new("IMPORT RECOVERY PHRASE")
                    .size(11.0)
                    .strong()
                    .color(CORAL),
            );
            field(ui, "12 or 24 English words", &mut self.import_phrase, true);
            let enabled = !self.import_phrase.trim().is_empty()
                && (self.wallet.is_none() || self.replace_confirmed);
            if ui
                .add_enabled(enabled && !self.busy, egui::Button::new("Import securely"))
                .clicked()
            {
                let mut phrase = std::mem::take(&mut self.import_phrase);
                let worker_phrase = phrase.clone();
                phrase.zeroize();
                self.spawn(context.clone(), move || {
                    Event::WalletImported(services::import_wallet(worker_phrase))
                });
            }
        });
        ui.add_space(14.0);
        card(ui, |ui| {
            ui.label(
                RichText::new("SECURITY BOUNDARY")
                    .size(11.0)
                    .strong()
                    .color(CORAL),
            );
            ui.label("Private key: Windows Credential Manager for the current Windows user.");
            ui.label("Public metadata: %LOCALAPPDATA%\\Vireon\\Desktop\\wallet.json.");
            ui.label("Signing: local process only; direct submission to 127.0.0.1; no signed file created.");
        });
    }
}

impl eframe::App for VireonApp {
    fn update(&mut self, context: &egui::Context, _frame: &mut eframe::Frame) {
        self.events();
        if !self.busy && self.last_refresh.elapsed() > Duration::from_secs(15) {
            self.refresh(context.clone());
        }
        self.title_bar(context);
        self.nav(context);
        egui::TopBottomPanel::bottom("network-footer")
            .exact_height(32.0)
            .frame(
                egui::Frame::new()
                    .fill(Color32::from_rgb(2, 11, 17))
                    .stroke(Stroke::new(1.0_f32, BORDER))
                    .inner_margin(egui::Margin::symmetric(14, 7)),
            )
            .show(context, |ui| {
                ui.horizontal(|ui| {
                    footer_item(
                        ui,
                        "BASE FEE",
                        &self
                            .network
                            .recent_blocks
                            .first()
                            .map(|block| {
                                format!("{} VIRE", services::format_atomic(block.base_fee_atomic))
                            })
                            .unwrap_or_else(|| "--".to_owned()),
                    );
                    footer_item(
                        ui,
                        "CHAIN",
                        &self
                            .network
                            .height
                            .map(|v| v.to_string())
                            .unwrap_or_else(|| "--".into()),
                    );
                    footer_item(ui, "MEMPOOL", &self.network.mempool_count.to_string());
                    footer_item(
                        ui,
                        "INDEX",
                        &self
                            .network
                            .indexed_height
                            .map(|v| v.to_string())
                            .unwrap_or_else(|| "--".into()),
                    );
                    footer_item(
                        ui,
                        "PEERS",
                        &format!(
                            "{} / {} VALIDATED",
                            self.network.connected_peer_count, self.network.validated_peer_count
                        ),
                    );
                    ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                        ui.label(
                            RichText::new("LOCAL SECURE SESSION")
                                .size(9.0)
                                .strong()
                                .color(GREEN),
                        );
                        ui.label(RichText::new("●").size(9.0).color(GREEN));
                    });
                });
            });
        egui::CentralPanel::default()
            .frame(
                egui::Frame::new()
                    .fill(CREAM)
                    .inner_margin(egui::Margin::symmetric(16, 14)),
            )
            .show(context, |ui| {
                draw_grid(ui);
                egui::ScrollArea::vertical().show(ui, |ui| match self.page {
                    Page::Overview => self.overview(ui, context),
                    Page::Wallet => self.wallet(ui, context),
                    Page::Send => self.send(ui, context),
                    Page::Mining => self.mining(ui, context),
                    Page::Explorer => self.explorer(ui, context),
                    Page::Blocks => self.blocks(ui, context),
                    Page::Transactions => self.transactions(ui, context),
                    Page::Node => self.node(ui, context),
                    Page::Rewards => self.rewards(ui, context),
                    Page::Assets => self.assets(ui, context),
                    Page::Settings => self.settings(ui, context),
                });
            });
        context.request_repaint_after(if self.busy {
            Duration::from_millis(100)
        } else {
            Duration::from_secs(1)
        });
    }
}

impl Drop for VireonApp {
    fn drop(&mut self) {
        self.import_phrase.zeroize();
        if let Some(value) = &mut self.recovery_phrase {
            value.zeroize();
        }
    }
}

fn configure_style(context: &egui::Context) {
    let mut fonts = FontDefinitions::default();
    if let Ok(bytes) = std::fs::read(r"C:\Windows\Fonts\bahnschrift.ttf") {
        fonts
            .font_data
            .insert("bahnschrift".to_owned(), FontData::from_owned(bytes).into());
        fonts
            .families
            .entry(FontFamily::Proportional)
            .or_default()
            .insert(0, "bahnschrift".to_owned());
    }
    context.set_fonts(fonts);
    let mut style = (*context.style()).clone();
    style.visuals = egui::Visuals::dark();
    style.visuals.panel_fill = CREAM;
    style.visuals.window_fill = PAPER;
    style.visuals.extreme_bg_color = Color32::from_rgb(2, 10, 15);
    style.visuals.faint_bg_color = PANEL_ALT;
    style.visuals.widgets.inactive.bg_fill = Color32::from_rgb(9, 29, 40);
    style.visuals.widgets.inactive.bg_stroke = Stroke::new(1.0_f32, BORDER);
    style.visuals.widgets.inactive.fg_stroke = Stroke::new(1.0_f32, INK);
    style.visuals.widgets.hovered.bg_fill = Color32::from_rgb(8, 53, 70);
    style.visuals.widgets.hovered.bg_stroke = Stroke::new(1.0_f32, TEAL);
    style.visuals.widgets.active.bg_fill = Color32::from_rgb(7, 71, 91);
    style.visuals.selection.bg_fill = TEAL.gamma_multiply(0.32);
    style.visuals.hyperlink_color = TEAL;
    style.spacing.item_spacing = egui::vec2(8.0, 8.0);
    style.spacing.button_padding = egui::vec2(12.0, 7.0);
    context.set_style(style);
}

fn draw_grid(ui: &egui::Ui) {
    let rect = ui.max_rect();
    let painter = ui.painter();
    let stroke = Stroke::new(0.5_f32, Color32::from_rgba_unmultiplied(16, 73, 94, 28));
    let step = 48.0;
    let mut x = rect.left();
    while x < rect.right() {
        painter.line_segment(
            [egui::pos2(x, rect.top()), egui::pos2(x, rect.bottom())],
            stroke,
        );
        x += step;
    }
    let mut y = rect.top();
    while y < rect.bottom() {
        painter.line_segment(
            [egui::pos2(rect.left(), y), egui::pos2(rect.right(), y)],
            stroke,
        );
        y += step;
    }
}

fn draw_qr(ui: &mut egui::Ui, value: &str, size: f32) {
    let Ok(code) = QrCode::new(value.as_bytes()) else {
        empty_state(ui, "Unable to encode this address.");
        return;
    };
    let width = code.width();
    let module = size / width as f32;
    let rendered_size = module * width as f32;
    let (rect, _) = ui.allocate_exact_size(Vec2::splat(rendered_size + 16.0), egui::Sense::hover());
    ui.painter()
        .rect_filled(rect, 4.0, Color32::from_rgb(1, 10, 16));
    let origin = rect.min + egui::vec2(8.0, 8.0);
    for y in 0..width {
        for x in 0..width {
            if code[(x, y)] == QrColor::Dark {
                let min = origin + egui::vec2(x as f32 * module, y as f32 * module);
                ui.painter().rect_filled(
                    egui::Rect::from_min_size(min, Vec2::splat(module + 0.2)),
                    0.0,
                    TEAL,
                );
            }
        }
    }
}

fn nav_button(ui: &mut egui::Ui, page: &mut Page, target: Page, icon: &str, label: &str) {
    let selected = *page == target;
    let text = RichText::new(format!("{icon}   {label}"))
        .size(12.0)
        .strong()
        .color(if selected {
            TEAL
        } else {
            Color32::from_rgb(150, 173, 187)
        });
    if ui
        .add_sized(
            [176.0, 37.0],
            egui::Button::new(text)
                .fill(if selected {
                    Color32::from_rgb(5, 42, 56)
                } else {
                    Color32::TRANSPARENT
                })
                .stroke(if selected {
                    Stroke::new(1.0_f32, TEAL)
                } else {
                    Stroke::NONE
                }),
        )
        .clicked()
    {
        *page = target;
    }
}

fn badge(ui: &mut egui::Ui, text: &str, color: Color32) {
    egui::Frame::new()
        .fill(color.gamma_multiply(0.08))
        .stroke(Stroke::new(1.0_f32, color.gamma_multiply(0.45)))
        .corner_radius(3)
        .inner_margin(egui::Margin::symmetric(10, 6))
        .show(ui, |ui| {
            ui.label(RichText::new(text).size(9.0).strong().color(color));
        });
}

fn panel(ui: &mut egui::Ui, body: impl FnOnce(&mut egui::Ui)) {
    egui::Frame::new()
        .fill(PAPER)
        .stroke(Stroke::new(1.0_f32, BORDER))
        .corner_radius(4)
        .inner_margin(egui::Margin::same(12))
        .show(ui, body);
}

fn section_title(ui: &mut egui::Ui, title: &str, detail: &str) {
    ui.horizontal(|ui| {
        ui.label(RichText::new(title).size(11.0).strong().color(INK));
        ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
            ui.label(RichText::new(detail).size(8.0).strong().color(TEAL));
        });
    });
    ui.separator();
}

fn status_line(ui: &mut egui::Ui, label: &str, running: bool) {
    ui.horizontal(|ui| {
        ui.label(
            RichText::new("●")
                .size(10.0)
                .color(if running { GREEN } else { MUTED }),
        );
        ui.label(RichText::new(label).size(10.0).strong().color(INK));
        ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
            ui.label(
                RichText::new(if running { "ONLINE" } else { "OFFLINE" })
                    .size(9.0)
                    .color(if running { GREEN } else { MUTED }),
            );
        });
    });
}

fn dashboard_metric(ui: &mut egui::Ui, label: &str, value: String, detail: &str, accent: Color32) {
    panel(ui, |ui| {
        ui.set_min_height(115.0);
        ui.label(RichText::new(label).size(10.0).strong().color(MUTED));
        ui.add_space(9.0);
        ui.label(RichText::new(value).size(25.0).strong().color(accent));
        ui.label(RichText::new(detail).size(10.0).color(MUTED));
    });
}

fn dashboard_wallet(ui: &mut egui::Ui, wallet: Option<&WalletMetadata>) {
    panel(ui, |ui| {
        ui.set_min_height(115.0);
        section_title(ui, "WALLET ADDRESS", "LOCAL KEY");
        if let Some(wallet) = wallet {
            ui.label(
                RichText::new(short(&wallet.address))
                    .size(14.0)
                    .strong()
                    .color(INK),
            );
            ui.label(
                RichText::new(&wallet.derivation_path)
                    .size(9.0)
                    .color(MUTED),
            );
            if ui.small_button("COPY ADDRESS").clicked() {
                ui.ctx().copy_text(wallet.address.clone());
            }
        } else {
            ui.label(
                RichText::new("NOT CONFIGURED")
                    .size(15.0)
                    .strong()
                    .color(GOLD),
            );
            ui.label(
                RichText::new("Create a secured local wallet")
                    .size(9.0)
                    .color(MUTED),
            );
        }
    });
}

fn dashboard_hashrate(ui: &mut egui::Ui, hashrate: Option<f64>) {
    panel(ui, |ui| {
        ui.set_min_height(115.0);
        section_title(ui, "CURRENT HASHRATE", "REAL-TIME");
        ui.label(
            RichText::new(hashrate.map(format_hashrate).unwrap_or_else(|| "--".into()))
                .size(25.0)
                .strong()
                .color(TEAL),
        );
        sparkline(ui, hashrate.unwrap_or_default());
    });
}

fn sparkline(ui: &mut egui::Ui, seed: f64) {
    let (rect, _) =
        ui.allocate_exact_size(Vec2::new(ui.available_width(), 34.0), egui::Sense::hover());
    let values = [
        0.18_f32, 0.42, 0.31, 0.57, 0.46, 0.69, 0.54, 0.78, 0.65, 0.84, 0.72, 0.9,
    ];
    let intensity = if seed > 0.0 { 1.0 } else { 0.35 };
    for index in 1..values.len() {
        let x1 = egui::lerp(
            rect.x_range(),
            (index - 1) as f32 / (values.len() - 1) as f32,
        );
        let x2 = egui::lerp(rect.x_range(), index as f32 / (values.len() - 1) as f32);
        let y1 = egui::lerp(rect.bottom()..=rect.top(), values[index - 1]);
        let y2 = egui::lerp(rect.bottom()..=rect.top(), values[index]);
        ui.painter().line_segment(
            [egui::pos2(x1, y1), egui::pos2(x2, y2)],
            Stroke::new(1.5_f32, TEAL.gamma_multiply(intensity)),
        );
    }
}

fn dashboard_chain(ui: &mut egui::Ui, network: &NetworkSnapshot) {
    panel(ui, |ui| {
        ui.set_min_height(176.0);
        section_title(ui, "RECENT BLOCK", "CHAIN TIP");
        compact_row(
            ui,
            "HEIGHT",
            &network
                .height
                .map(|value| value.to_string())
                .unwrap_or_else(|| "--".into()),
            TEAL,
        );
        compact_row(
            ui,
            "HASH",
            &network
                .tip_hash
                .as_deref()
                .map(short)
                .unwrap_or_else(|| "--".into()),
            INK,
        );
        compact_row(
            ui,
            "TRANSACTIONS",
            &network.latest_block_transactions.to_string(),
            INK,
        );
        compact_row(
            ui,
            "REWARD",
            &network
                .latest_block_reward_atomic
                .map(services::format_atomic)
                .unwrap_or_else(|| "--".into()),
            GOLD,
        );
        compact_row(
            ui,
            "FEES",
            &network
                .latest_block_fees_atomic
                .map(services::format_atomic)
                .unwrap_or_else(|| "--".into()),
            GREEN,
        );
        compact_row(
            ui,
            "TIMESTAMP",
            &network
                .latest_block_timestamp
                .map(|value| value.to_string())
                .unwrap_or_else(|| "--".into()),
            MUTED,
        );
    });
}

fn dashboard_activity(ui: &mut egui::Ui, network: &NetworkSnapshot) {
    panel(ui, |ui| {
        ui.set_min_height(176.0);
        section_title(ui, "CHAIN ACTIVITY", "INDEXED DATA");
        compact_row(
            ui,
            "INDEXED HEIGHT",
            &network
                .indexed_height
                .map(|value| value.to_string())
                .unwrap_or_else(|| "--".into()),
            TEAL,
        );
        compact_row(ui, "BLOCKS", &network.indexed_blocks.to_string(), INK);
        compact_row(
            ui,
            "TRANSACTIONS",
            &network.indexed_transactions.to_string(),
            INK,
        );
        compact_row(ui, "ADDRESSES", &network.indexed_addresses.to_string(), INK);
        compact_row(
            ui,
            "MEMPOOL",
            &format!("{} pending", network.mempool_count),
            if network.mempool_count > 0 {
                GOLD
            } else {
                GREEN
            },
        );
    });
}

fn dashboard_health(ui: &mut egui::Ui, network: &NetworkSnapshot) {
    panel(ui, |ui| {
        ui.set_min_height(176.0);
        section_title(ui, "NODE HEALTH", "LOCAL SERVICES");
        status_line(ui, "NODE", network.node_running);
        status_line(ui, "RPC GATEWAY", network.rpc_running);
        status_line(ui, "INDEXER", network.indexer_ready);
        status_line(ui, "CPU MINER", network.miner_running);
        status_line(ui, "P2P TRANSPORT", network.local_peer_id.is_some());
        ui.separator();
        ui.label(RichText::new(&network.detail).size(9.0).color(MUTED));
    });
}

fn dashboard_supply(ui: &mut egui::Ui, network: &NetworkSnapshot) {
    panel(ui, |ui| {
        ui.set_min_height(145.0);
        section_title(ui, "EMITTED SUPPLY", "PROTOCOL");
        let emitted = network
            .emitted_supply_atomic
            .map(services::format_atomic)
            .unwrap_or_else(|| "--".into());
        let maximum = network
            .max_supply_atomic
            .map(services::format_atomic)
            .unwrap_or_else(|| "60,000,000".into());
        ui.label(RichText::new(emitted).size(22.0).strong().color(GOLD));
        ui.label(
            RichText::new(format!("of {maximum} VIRE maximum"))
                .size(10.0)
                .color(MUTED),
        );
        ui.add_space(8.0);
        status_line(ui, "SUPPLY CHECK", network.online);
    });
}

fn dashboard_network(ui: &mut egui::Ui, network: &NetworkSnapshot) {
    panel(ui, |ui| {
        ui.set_min_height(145.0);
        section_title(ui, "NETWORK STATS", "VERIFIED LOCALLY");
        compact_row(
            ui,
            "CHAIN HEIGHT",
            &network
                .height
                .map(|value| value.to_string())
                .unwrap_or_else(|| "--".into()),
            TEAL,
        );
        compact_row(ui, "BLOCKS", &network.block_count.to_string(), INK);
        compact_row(ui, "PENDING TX", &network.mempool_count.to_string(), INK);
        compact_row(
            ui,
            "CONNECTED PEERS",
            &network.connected_peer_count.to_string(),
            TEAL,
        );
        compact_row(
            ui,
            "VALIDATING PEERS",
            &network.validating_peer_count.to_string(),
            INK,
        );
        compact_row(
            ui,
            "STATUS",
            if network.status_label.is_empty() {
                "Mainnet Candidate"
            } else {
                &network.status_label
            },
            GOLD,
        );
    });
}

fn compact_row(ui: &mut egui::Ui, label: &str, value: &str, color: Color32) {
    ui.horizontal(|ui| {
        ui.label(RichText::new(label).size(9.0).color(MUTED));
        ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
            ui.label(RichText::new(value).size(10.0).strong().color(color));
        });
    });
}

fn table_header(ui: &mut egui::Ui, labels: &[&str]) {
    ui.columns(labels.len(), |columns| {
        for (column, label) in columns.iter_mut().zip(labels) {
            column.label(RichText::new(*label).size(9.0).strong().color(MUTED));
        }
    });
    ui.separator();
}

fn table_cell(ui: &mut egui::Ui, value: &str, color: Color32) {
    ui.label(RichText::new(value).size(10.0).color(color));
}

fn empty_state(ui: &mut egui::Ui, text: &str) {
    egui::Frame::new()
        .fill(PANEL_ALT)
        .inner_margin(egui::Margin::same(14))
        .show(ui, |ui| {
            ui.label(RichText::new(text).color(MUTED));
        });
}

fn planned_card(ui: &mut egui::Ui, title: &str, detail: &str, status: &str) {
    panel(ui, |ui| {
        ui.label(RichText::new(title).size(11.0).strong().color(INK));
        ui.label(RichText::new(detail).size(10.0).color(MUTED));
        ui.add_space(8.0);
        badge(ui, status, GOLD);
    });
}

fn display_u64(value: Option<u64>) -> String {
    value.map_or_else(|| "--".to_owned(), |value| value.to_string())
}

fn quick_action(ui: &mut egui::Ui, icon: &str, label: &str) -> bool {
    ui.add_sized(
        [ui.available_width(), 43.0],
        egui::Button::new(
            RichText::new(format!("{icon}  {label}"))
                .size(10.0)
                .strong()
                .color(INK),
        )
        .fill(PANEL_ALT)
        .stroke(Stroke::new(1.0_f32, BORDER)),
    )
    .clicked()
}

fn footer_item(ui: &mut egui::Ui, label: &str, value: &str) {
    ui.label(RichText::new(label).size(8.0).color(MUTED));
    ui.label(RichText::new(value).size(9.0).strong().color(INK));
    ui.separator();
}

fn pill(ui: &mut egui::Ui, online: bool) {
    let color = if online {
        GREEN
    } else {
        Color32::from_rgb(220, 85, 85)
    };
    egui::Frame::new()
        .fill(color.gamma_multiply(0.12))
        .corner_radius(20)
        .inner_margin(egui::Margin::symmetric(12, 7))
        .show(ui, |ui| {
            ui.label(
                RichText::new(if online { "RPC ONLINE" } else { "RPC OFFLINE" })
                    .size(11.0)
                    .strong()
                    .color(color),
            );
        });
}

fn metric(ui: &mut egui::Ui, label: &str, value: String, detail: &str) {
    card(ui, |ui| {
        ui.label(RichText::new(label).size(11.0).strong().color(CORAL));
        ui.label(RichText::new(value).size(25.0).strong().color(INK));
        ui.label(RichText::new(detail).color(MUTED));
    });
}

fn format_hashrate(value: f64) -> String {
    if value >= 1_000_000.0 {
        format!("{:.2} MH/s", value / 1_000_000.0)
    } else if value >= 1_000.0 {
        format!("{:.2} kH/s", value / 1_000.0)
    } else {
        format!("{value:.0} H/s")
    }
}

fn card(ui: &mut egui::Ui, body: impl FnOnce(&mut egui::Ui)) {
    egui::Frame::new()
        .fill(PAPER)
        .stroke(Stroke::new(1.0_f32, BORDER))
        .corner_radius(5)
        .inner_margin(egui::Margin::same(14))
        .show(ui, body);
}

fn field(ui: &mut egui::Ui, label: &str, value: &mut String, password: bool) {
    ui.label(RichText::new(label).size(12.0).strong().color(INK));
    ui.add(
        egui::TextEdit::singleline(value)
            .desired_width(f32::INFINITY)
            .password(password),
    );
}

fn row(ui: &mut egui::Ui, label: &str, value: &str) {
    ui.horizontal_wrapped(|ui| {
        ui.label(RichText::new(label).color(MUTED));
        ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
            ui.label(RichText::new(value).strong().color(INK));
        });
    });
    ui.separator();
}

fn short(value: &str) -> String {
    if value.len() <= 16 {
        value.to_owned()
    } else {
        format!("{}...{}", &value[..8], &value[value.len() - 8..])
    }
}
