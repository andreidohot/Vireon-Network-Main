import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { JsonStore } from "./storage.js";
import { createLedgerPrismaClient } from "./ledger-prisma.js";
import { createVireonEmbed } from "./embed-factory.js";
import { WALLET_LINKS_COLLECTION, walletLinkId } from "./rewards.js";

export const WALLET_CHALLENGES_COLLECTION = "wallet-link-challenges";
export const DEFAULT_PAYMENT_ASSET = "VIRE";

const DEFAULT_CHALLENGE_TTL_MS = 15 * 60 * 1000;

export async function createWalletRegistrationService({
  store,
  env = process.env,
  fetchImpl = globalThis.fetch,
  ledgerStore = null,
  now = () => new Date()
} = {}) {
  const resolvedLedgerStore = ledgerStore ?? await createLedgerStore({ env });
  return new WalletRegistrationService({
    store,
    ledgerStore: resolvedLedgerStore,
    env,
    fetchImpl,
    now
  });
}

export async function createLedgerStore({ env = process.env } = {}) {
  if (env.LEDGER_STORAGE_DRIVER === "json" || env.STORAGE_DRIVER !== "prisma") {
    return new JsonLedgerStore({
      dataDir: env.LEDGER_DATA_DIR ?? path.join(env.BOT_DATA_DIR ?? "./data", "ledger")
    });
  }

  try {
    return new PrismaLedgerStore({
      prisma: await createLedgerPrismaClient()
    });
  } catch {
    return new JsonLedgerStore({
      dataDir: env.LEDGER_DATA_DIR ?? path.join(env.BOT_DATA_DIR ?? "./data", "ledger")
    });
  }
}

export class WalletRegistrationService {
  constructor({ store, ledgerStore, env = process.env, fetchImpl = globalThis.fetch, now = () => new Date() }) {
    this.store = store;
    this.ledgerStore = ledgerStore;
    this.env = env;
    this.fetchImpl = fetchImpl;
    this.now = now;
  }

  async getOrCreateCustodialWallet({ guildId, userId, userTag = null }) {
    const existing = await this.ledgerStore.findWalletByDiscordUserId(userId);
    if (existing?.custodyMode === "custodial") {
      await this.syncWalletLink({ guildId, userId, userTag, wallet: existing, status: "custodial" });
      return this.buildRegistrationResult({ wallet: existing, created: false, mode: "custodial" });
    }

    if (existing) {
      return this.buildRegistrationResult({ wallet: existing, created: false, mode: existing.custodyMode });
    }

    const derivationIndex = await this.ledgerStore.countWallets();
    const derivationPath = `m/44'/984'/0'/0/${derivationIndex}`;
    const masterSeed = await loadWalletHdMasterSeed(this.env);
    const derived = deriveCustodialWalletMaterial({
      masterSeed,
      derivationPath,
      prefix: this.env.VIREON_WALLET_ADDRESS_PREFIX ?? "vire"
    });
    const encryptedKeyEnvelope = createDerivationEnvelope({
      derivationPath,
      address: derived.address,
      publicKeyHash: derived.publicKeyHash
    });
    masterSeed.fill(0);
    const wallet = await this.ledgerStore.createWallet({
      id: `wallet_${crypto.randomUUID()}`,
      discordUserId: userId,
      custodyMode: "custodial",
      address: derived.address,
      encryptedKeyEnvelope,
      externalAddress: null,
      dailyLimit: this.env.WALLET_DEFAULT_DAILY_LIMIT ?? "0",
      balanceLimit: this.env.WALLET_DEFAULT_BALANCE_LIMIT ?? "0"
    });

    await this.ledgerStore.ensureBalance(wallet.id, DEFAULT_PAYMENT_ASSET);
    await this.ledgerStore.addTransaction({
      id: `tx_${crypto.randomUUID()}`,
      walletId: wallet.id,
      type: "wallet_registered",
      status: "recorded",
      amount: "0",
      asset: DEFAULT_PAYMENT_ASSET,
      toAddress: wallet.address,
      metadata: JSON.stringify({ custodyMode: "custodial" })
    });
    await this.syncWalletLink({ guildId, userId, userTag, wallet, status: "custodial" });

    return this.buildRegistrationResult({ wallet, created: true, mode: "custodial" });
  }

  async createExternalWalletChallenge({ guildId, userId, userTag = null, address }) {
    const normalizedAddress = normalizeAddress(address);
    if (!normalizedAddress) {
      throw new Error("A wallet address is required.");
    }

    const nonce = crypto.randomBytes(16).toString("hex");
    const createdAt = this.now().toISOString();
    const expiresAt = new Date(this.now().getTime() + DEFAULT_CHALLENGE_TTL_MS).toISOString();
    const message = [
      "Vireon wallet link challenge",
      `Discord user: ${userId}`,
      `Guild: ${guildId}`,
      `Address: ${normalizedAddress}`,
      `Nonce: ${nonce}`,
      `Expires: ${expiresAt}`
    ].join("\n");
    const id = challengeId({ guildId, userId, address: normalizedAddress });
    const challengePayload = {
      id,
      guildId,
      userId,
      userTag,
      address: normalizedAddress,
      nonce,
      message,
      status: "pending",
      createdAt,
      expiresAt
    };
    const challenge = await this.store.update(WALLET_CHALLENGES_COLLECTION, (item) => item.id === id, () => challengePayload)
      ?? await this.store.add(WALLET_CHALLENGES_COLLECTION, challengePayload);

    return {
      ok: true,
      status: "pending",
      challenge,
      mockSignature: this.env.WALLET_ALLOW_MOCK_SIGNATURES === "true"
        ? createMockSignature({ address: normalizedAddress, message, secret: getMockSignatureSecret(this.env) })
        : null
    };
  }

  async verifyExternalWalletLink({ guildId, userId, userTag = null, address, signature }) {
    const normalizedAddress = normalizeAddress(address);
    const normalizedSignature = String(signature ?? "").trim();
    if (!normalizedAddress || !normalizedSignature) {
      throw new Error("address and signature are required.");
    }

    const challenge = await this.getPendingChallenge({ guildId, userId, address: normalizedAddress });
    if (!challenge) {
      throw new Error("No pending wallet challenge exists for this address. Run `/register external` first.");
    }
    if (Date.parse(challenge.expiresAt) < this.now().getTime()) {
      await this.store.update(WALLET_CHALLENGES_COLLECTION, (item) => item.id === challenge.id, () => ({ status: "expired" }));
      throw new Error("The wallet challenge expired. Run `/register external` again.");
    }

    const verification = await verifyWalletSignature({
      address: normalizedAddress,
      message: challenge.message,
      signature: normalizedSignature,
      env: this.env,
      fetchImpl: this.fetchImpl
    });
    if (!verification.valid) {
      throw new Error(verification.message ?? "Wallet signature could not be verified.");
    }

    const wallet = await this.upsertExternalWallet({ userId, address: normalizedAddress });
    await this.store.update(WALLET_CHALLENGES_COLLECTION, (item) => item.id === challenge.id, () => ({
      status: "verified",
      verifiedAt: this.now().toISOString(),
      verifier: verification.verifier
    }));
    await this.syncWalletLink({ guildId, userId, userTag, wallet, status: "verified" });

    return this.buildRegistrationResult({ wallet, created: verification.created ?? false, mode: "external" });
  }

  async getUserWallet({ guildId, userId, userTag = null }) {
    const wallet = await this.ledgerStore.findWalletByDiscordUserId(userId);
    if (!wallet) return null;
    await this.syncWalletLink({
      guildId,
      userId,
      userTag,
      wallet,
      status: wallet.custodyMode === "custodial" ? "custodial" : "verified"
    });
    return this.buildRegistrationResult({ wallet, created: false, mode: wallet.custodyMode });
  }

  async getPaymentLinkData(token) {
    const wallet = await this.resolvePaymentLinkWallet(token);
    if (!wallet) return null;

    const balances = await this.ledgerStore.listBalances(wallet.id);
    const transactions = await this.ledgerStore.listTransactions(wallet.id, 30);

    return {
      ok: true,
      wallet: sanitizeWallet(wallet),
      balances,
      transactions: transactions.map(sanitizeTransaction)
    };
  }

  async requestWithdrawal({ token, toAddress, amount, asset = DEFAULT_PAYMENT_ASSET }) {
    const wallet = await this.resolvePaymentLinkWallet(token);
    if (!wallet) {
      const error = new Error("Payment link not found.");
      error.statusCode = 404;
      throw error;
    }

    const normalizedToAddress = normalizeAddress(toAddress);
    if (normalizedToAddress.length < 8) {
      const error = new Error("A valid external wallet address is required.");
      error.statusCode = 400;
      throw error;
    }

    const normalizedAsset = String(asset ?? DEFAULT_PAYMENT_ASSET).trim().toUpperCase() || DEFAULT_PAYMENT_ASSET;
    const amountUnits = parseAssetAmountToUnits(amount);
    if (amountUnits <= 0n) {
      const error = new Error("Withdrawal amount must be greater than zero.");
      error.statusCode = 400;
      throw error;
    }

    const balance = (await this.ledgerStore.listBalances(wallet.id)).find((item) => item.asset === normalizedAsset)
      ?? await this.ledgerStore.ensureBalance(wallet.id, normalizedAsset);
    const availableUnits = parseAssetAmountToUnits(balance.available);
    const lockedUnits = parseAssetAmountToUnits(balance.locked);
    if (availableUnits < amountUnits) {
      const error = new Error("Insufficient available balance for withdrawal.");
      error.statusCode = 400;
      throw error;
    }

    const nextBalance = await this.ledgerStore.updateBalance(wallet.id, normalizedAsset, {
      available: formatAssetUnits(availableUnits - amountUnits),
      locked: formatAssetUnits(lockedUnits + amountUnits)
    });
    const transaction = await this.ledgerStore.addTransaction({
      id: `tx_${crypto.randomUUID()}`,
      walletId: wallet.id,
      type: "withdrawal",
      status: "pending_review",
      amount: formatAssetUnits(amountUnits),
      asset: normalizedAsset,
      fromAddress: wallet.address,
      toAddress: normalizedToAddress,
      metadata: JSON.stringify({ requestedVia: "payment-link" })
    });

    return {
      ok: true,
      wallet: sanitizeWallet(wallet),
      balance: serializeBalance(nextBalance),
      withdrawal: sanitizeTransaction(transaction),
      payment: await this.getPaymentLinkData(token)
    };
  }

  async listWalletSummaries(limit = 100) {
    const wallets = await this.ledgerStore.listWallets();
    return wallets.slice(-limit).reverse().map((wallet) => ({
      ...sanitizeWallet(wallet),
      paymentLink: this.getPaymentLink(wallet)
    }));
  }

  async resolvePaymentLinkWallet(token) {
    const normalizedToken = String(token ?? "").trim();
    if (!normalizedToken) return null;
    const wallets = await this.ledgerStore.listWallets();
    return wallets.find((item) => this.createPaymentToken(item) === normalizedToken) ?? null;
  }

  async upsertExternalWallet({ userId, address }) {
    const existing = await this.ledgerStore.findWalletByDiscordUserId(userId);
    if (existing) {
      const wallet = await this.ledgerStore.updateWallet(existing.id, {
        custodyMode: "external",
        address,
        externalAddress: address,
        encryptedKeyEnvelope: null
      });
      await this.ledgerStore.ensureBalance(wallet.id, DEFAULT_PAYMENT_ASSET);
      return wallet;
    }

    const wallet = await this.ledgerStore.createWallet({
      id: `wallet_${crypto.randomUUID()}`,
      discordUserId: userId,
      custodyMode: "external",
      address,
      encryptedKeyEnvelope: null,
      externalAddress: address,
      dailyLimit: this.env.WALLET_DEFAULT_DAILY_LIMIT ?? "0",
      balanceLimit: this.env.WALLET_DEFAULT_BALANCE_LIMIT ?? "0"
    });
    await this.ledgerStore.ensureBalance(wallet.id, DEFAULT_PAYMENT_ASSET);
    await this.ledgerStore.addTransaction({
      id: `tx_${crypto.randomUUID()}`,
      walletId: wallet.id,
      type: "wallet_linked",
      status: "recorded",
      amount: "0",
      asset: DEFAULT_PAYMENT_ASSET,
      toAddress: wallet.address,
      metadata: JSON.stringify({ custodyMode: "external" })
    });
    return wallet;
  }

  async syncWalletLink({ guildId, userId, userTag = null, wallet, status }) {
    const link = {
      id: walletLinkId(guildId, userId, wallet.address),
      guildId,
      userId,
      userTag,
      address: wallet.address,
      walletId: wallet.id,
      custodyMode: wallet.custodyMode,
      status,
      linkedAt: wallet.createdAt ?? this.now().toISOString(),
      verifiedAt: status === "verified" || status === "custodial" ? this.now().toISOString() : null,
      paymentLink: this.getPaymentLink(wallet)
    };

    const updated = await this.store.update(WALLET_LINKS_COLLECTION, (item) => item.id === link.id, () => link);
    return updated ?? this.store.add(WALLET_LINKS_COLLECTION, link);
  }

  async getPendingChallenge({ guildId, userId, address }) {
    const challenges = await this.store.list(WALLET_CHALLENGES_COLLECTION);
    return challenges
      .filter((challenge) =>
        challenge.guildId === guildId
        && challenge.userId === userId
        && challenge.address === address
        && challenge.status === "pending"
      )
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0] ?? null;
  }

  buildRegistrationResult({ wallet, created, mode }) {
    return {
      ok: true,
      created,
      mode,
      wallet: sanitizeWallet(wallet),
      paymentLink: this.getPaymentLink(wallet)
    };
  }

  getPaymentLink(wallet) {
    const baseUrl = getPublicBaseUrl(this.env);
    const token = this.createPaymentToken(wallet);
    return `${baseUrl.replace(/\/+$/, "")}/admin/pay/${encodeURIComponent(token)}`;
  }

  createPaymentToken(wallet) {
    const payload = `${wallet.id}.${wallet.discordUserId}.${wallet.address}`;
    const signature = crypto
      .createHmac("sha256", getPaymentLinkSecret(this.env))
      .update(payload)
      .digest("base64url")
      .slice(0, 32);
    return `${wallet.id}.${signature}`;
  }
}

export function registerWalletRegistrationHandlers({ walletRegistration }) {
  return async function handleRegisterCommand(interaction) {
    if (!interaction.isChatInputCommand() || interaction.commandName !== "register") return false;

    await interaction.deferReply({ ephemeral: true });
    const subcommand = interaction.options.getSubcommand(false) ?? "status";
    const context = {
      guildId: interaction.guildId,
      userId: interaction.user.id,
      userTag: interaction.user.tag ?? interaction.user.username
    };

    if (subcommand === "custodial") {
      const result = await walletRegistration.getOrCreateCustodialWallet(context);
      await interaction.editReply({ embeds: [buildRegisterEmbed(result)] });
      return true;
    }

    if (subcommand === "external") {
      const result = await walletRegistration.createExternalWalletChallenge({
        ...context,
        address: interaction.options.getString("address", true)
      });
      await interaction.editReply({ embeds: [buildChallengeEmbed(result)] });
      return true;
    }

    if (subcommand === "verify") {
      const result = await walletRegistration.verifyExternalWalletLink({
        ...context,
        address: interaction.options.getString("address", true),
        signature: interaction.options.getString("signature", true)
      });
      await interaction.editReply({ embeds: [buildRegisterEmbed(result)] });
      return true;
    }

    const result = await walletRegistration.getUserWallet(context);
    await interaction.editReply({ embeds: [buildStatusEmbed(result)] });
    return true;
  };
}

export function buildRegisterEmbed(result) {
  return createVireonEmbed({
    title: result.created ? "Vireon Wallet Registered" : "Vireon Wallet",
    description: result.mode === "custodial"
      ? "Your custodial Vireon wallet is ready. The master seed stays in env/vault, and only derivation metadata is stored server-side."
      : "Your external Vireon wallet link is verified.",
    color: 0xd4af37,
    fields: [
      { name: "Mode", value: result.mode, inline: true },
      { name: "Address", value: formatInlineCode(result.wallet.address), inline: false },
      { name: "Payment Link", value: result.paymentLink, inline: false }
    ],
    footer: "Vireon Wallet | Keep wallet secrets private"
  });
}

export function buildChallengeEmbed(result) {
  const lines = [
    "Sign this challenge with your external Vireon wallet, then run `/register verify` with the signature.",
    "",
    "```text",
    result.challenge.message,
    "```"
  ];
  if (result.mockSignature) {
    lines.push("", "Dev mock signature:", `\`${result.mockSignature}\``);
  }

  return createVireonEmbed({
    title: "Vireon Wallet Challenge",
    description: lines.join("\n"),
    color: 0xd4af37,
    fields: [
      { name: "Address", value: formatInlineCode(result.challenge.address), inline: false },
      { name: "Expires", value: result.challenge.expiresAt, inline: true }
    ],
    footer: "Vireon Wallet | Challenge-response link"
  });
}

export function buildStatusEmbed(result) {
  if (!result) {
    return createVireonEmbed({
      title: "Vireon Wallet",
      description: "No wallet is linked yet. Use `/register custodial` or `/register external address:<wallet>`.",
      color: 0x8b1e24,
      footer: "Vireon Wallet | Registration required"
    });
  }
  return buildRegisterEmbed(result);
}

export function renderPaymentLinkHtml(data) {
  if (!data) {
    return renderHtmlPage("Vireon Payment Link", "<main><h1>Payment link not found</h1><p>This link is invalid or expired.</p></main>");
  }

  const balanceRows = data.balances.length
    ? data.balances.map((balance) => `<tr><td>${escapeHtml(balance.asset)}</td><td>${escapeHtml(balance.available)}</td><td>${escapeHtml(balance.locked)}</td></tr>`).join("")
    : "<tr><td colspan=\"3\">No balances yet.</td></tr>";
  const transactionRows = data.transactions.length
    ? data.transactions.map((tx) => `<tr><td>${escapeHtml(tx.createdAt)}</td><td>${escapeHtml(tx.type)}</td><td>${escapeHtml(tx.status)}</td><td>${escapeHtml(tx.amount)} ${escapeHtml(tx.asset)}</td></tr>`).join("")
    : "<tr><td colspan=\"4\">No transaction history yet.</td></tr>";
  const body = `
    <main>
      <section class="hero">
        <span>Vireon Payment Link</span>
        <h1>${escapeHtml(data.wallet.address)}</h1>
        <p>Wallet mode: ${escapeHtml(data.wallet.custodyMode)}. This page shows public receive data only.</p>
      </section>
      <section>
        <h2>Balance</h2>
        <table><thead><tr><th>Asset</th><th>Available</th><th>Locked</th></tr></thead><tbody>${balanceRows}</tbody></table>
      </section>
      <section>
        <h2>History</h2>
        <table><thead><tr><th>Date</th><th>Type</th><th>Status</th><th>Amount</th></tr></thead><tbody>${transactionRows}</tbody></table>
      </section>
    </main>
  `;
  return renderHtmlPage("Vireon Payment Link", body);
}

export async function verifyWalletSignature({ address, message, signature, env = process.env, fetchImpl = globalThis.fetch }) {
  if (env.VIREON_WALLET_SIGNATURE_VERIFY_URL) {
    const response = await fetchImpl(env.VIREON_WALLET_SIGNATURE_VERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ address, message, signature, network: "vireon" })
    });
    if (!response.ok) {
      return { valid: false, verifier: "remote", message: `Signature verifier returned HTTP ${response.status}.` };
    }
    const payload = await response.json();
    return {
      valid: Boolean(payload.valid ?? payload.ok),
      verifier: "remote",
      message: payload.message
    };
  }

  if (env.WALLET_ALLOW_MOCK_SIGNATURES === "true") {
    const expected = createMockSignature({ address, message, secret: getMockSignatureSecret(env) });
    const valid = signature.length === expected.length
      && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    return {
      valid,
      verifier: "mock",
      message: "Mock signature verification failed."
    };
  }

  return {
    valid: false,
    verifier: "none",
    message: "No wallet signature verifier is configured. Set VIREON_WALLET_SIGNATURE_VERIFY_URL or enable WALLET_ALLOW_MOCK_SIGNATURES for dev."
  };
}

export function createMockSignature({ address, message, secret }) {
  return crypto.createHmac("sha256", secret).update(`${address}\n${message}`).digest("hex");
}

export function deriveVireonAddress({ seed, derivationPath, prefix = "vire" }) {
  return deriveCustodialWalletMaterial({ masterSeed: seed, derivationPath, prefix }).address;
}

export function deriveCustodialWalletMaterial({ masterSeed, derivationPath, prefix = "vire" }) {
  const privateMaterial = crypto.createHmac("sha512", masterSeed).update(derivationPath).digest();
  const publicKeyHash = crypto.createHash("sha256").update(privateMaterial).digest("base64url").toLowerCase().replace(/[^a-z0-9]/g, "");
  const address = `${prefix}_${publicKeyHash.slice(0, 42)}`;
  privateMaterial.fill(0);
  return { address, publicKeyHash };
}

export function createDerivationEnvelope({ derivationPath, address, publicKeyHash }) {
  return JSON.stringify({
    version: 2,
    custody: "hd-env-master",
    derivationPath,
    address,
    publicKeyHash,
    keyStorage: "env-or-vault",
    masterSeedStoredInDatabase: false,
    derivedPrivateKeyStoredInDatabase: false
  });
}

export class JsonLedgerStore {
  constructor({ dataDir }) {
    this.store = new JsonStore({ dataDir });
  }

  async countWallets() {
    return (await this.store.list("ledger-wallets")).length;
  }

  async listWallets() {
    return this.store.list("ledger-wallets");
  }

  async findWalletByDiscordUserId(discordUserId) {
    return (await this.store.list("ledger-wallets")).find((wallet) => wallet.discordUserId === discordUserId) ?? null;
  }

  async createWallet(wallet) {
    return this.store.add("ledger-wallets", wallet);
  }

  async updateWallet(walletId, updates) {
    return this.store.update("ledger-wallets", (wallet) => wallet.id === walletId, () => updates);
  }

  async ensureBalance(walletId, asset = DEFAULT_PAYMENT_ASSET) {
    const existing = (await this.store.list("ledger-balances")).find((balance) => balance.walletId === walletId && balance.asset === asset);
    if (existing) return existing;
    return this.store.add("ledger-balances", {
      id: `balance_${walletId}_${asset}`,
      walletId,
      asset,
      available: "0",
      locked: "0"
    });
  }

  async listBalances(walletId) {
    return (await this.store.list("ledger-balances")).filter((balance) => balance.walletId === walletId);
  }

  async updateBalance(walletId, asset, updates) {
    return this.store.update("ledger-balances", (balance) => balance.walletId === walletId && balance.asset === asset, () => updates);
  }

  async addTransaction(transaction) {
    return this.store.add("ledger-transactions", transaction);
  }

  async updateTransaction(transactionId, updates) {
    return this.store.update("ledger-transactions", (transaction) => transaction.id === transactionId, () => updates);
  }

  async listTransactionsByStatuses(statuses, limit = 100) {
    const wanted = new Set(statuses);
    return (await this.store.list("ledger-transactions"))
      .filter((transaction) => wanted.has(transaction.status))
      .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))
      .slice(0, limit);
  }

  async listTransactions(walletId, limit = 30) {
    return (await this.store.list("ledger-transactions"))
      .filter((transaction) => transaction.walletId === walletId)
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
      .slice(0, limit);
  }
}

export class PrismaLedgerStore {
  constructor({ prisma }) {
    this.prisma = prisma;
  }

  async countWallets() {
    return this.prisma.ledgerWallet.count();
  }

  async listWallets() {
    const wallets = await this.prisma.ledgerWallet.findMany({ orderBy: { createdAt: "asc" } });
    return wallets.map(serializeWallet);
  }

  async findWalletByDiscordUserId(discordUserId) {
    const wallet = await this.prisma.ledgerWallet.findUnique({ where: { discordUserId } });
    return wallet ? serializeWallet(wallet) : null;
  }

  async createWallet(wallet) {
    const created = await this.prisma.ledgerWallet.create({ data: wallet });
    return serializeWallet(created);
  }

  async updateWallet(walletId, updates) {
    const updated = await this.prisma.ledgerWallet.update({ where: { id: walletId }, data: updates });
    return serializeWallet(updated);
  }

  async ensureBalance(walletId, asset = DEFAULT_PAYMENT_ASSET) {
    const balance = await this.prisma.ledgerBalance.upsert({
      where: { walletId_asset: { walletId, asset } },
      create: { id: `balance_${walletId}_${asset}`, walletId, asset, available: "0", locked: "0" },
      update: {}
    });
    return serializeBalance(balance);
  }

  async listBalances(walletId) {
    const balances = await this.prisma.ledgerBalance.findMany({ where: { walletId }, orderBy: { createdAt: "asc" } });
    return balances.map(serializeBalance);
  }

  async updateBalance(walletId, asset, updates) {
    const balance = await this.prisma.ledgerBalance.update({
      where: { walletId_asset: { walletId, asset } },
      data: updates
    });
    return serializeBalance(balance);
  }

  async addTransaction(transaction) {
    const created = await this.prisma.ledgerTransaction.create({ data: transaction });
    return serializeTransaction(created);
  }

  async updateTransaction(transactionId, updates) {
    const updated = await this.prisma.ledgerTransaction.update({
      where: { id: transactionId },
      data: updates
    });
    return serializeTransaction(updated);
  }

  async listTransactionsByStatuses(statuses, limit = 100) {
    const transactions = await this.prisma.ledgerTransaction.findMany({
      where: { status: { in: statuses } },
      orderBy: { createdAt: "asc" },
      take: limit
    });
    return transactions.map(serializeTransaction);
  }

  async listTransactions(walletId, limit = 30) {
    const transactions = await this.prisma.ledgerTransaction.findMany({
      where: { walletId },
      orderBy: { createdAt: "desc" },
      take: limit
    });
    return transactions.map(serializeTransaction);
  }
}

export async function loadWalletHdMasterSeed(env) {
  const source = await getMasterSeedSource(env);

  if (!source) {
    throw new Error("WALLET_HD_MASTER_SEED, WALLET_HD_MASTER_SEED_BASE64, WALLET_HD_MASTER_SEED_HEX or WALLET_HD_MASTER_SEED_FILE is required for custodial wallet derivation.");
  }

  const seed = decodeMasterSeed(source.value, source.type);
  if (seed.length < 32) {
    throw new Error("Wallet HD master seed must decode to at least 32 bytes.");
  }
  return seed;
}

async function getMasterSeedSource(env) {
  if (hasValue(env.WALLET_HD_MASTER_SEED_BASE64)) return { type: "base64", value: env.WALLET_HD_MASTER_SEED_BASE64 };
  if (hasValue(env.WALLET_HD_MASTER_SEED_HEX)) return { type: "hex", value: env.WALLET_HD_MASTER_SEED_HEX };
  if (hasValue(env.WALLET_HD_MASTER_SEED)) return { type: "auto", value: env.WALLET_HD_MASTER_SEED };
  if (hasValue(env.WALLET_HD_MASTER_SEED_FILE)) {
    return {
      type: "auto",
      value: (await readFile(env.WALLET_HD_MASTER_SEED_FILE, "utf8")).trim()
    };
  }
  return null;
}

function decodeMasterSeed(value, type) {
  if (type === "base64") return Buffer.from(String(value), "base64");
  if (type === "hex") return Buffer.from(String(value).replace(/^0x/, ""), "hex");

  const text = String(value).trim();
  if (/^(base64:)/i.test(text)) return Buffer.from(text.replace(/^base64:/i, ""), "base64");
  if (/^(hex:|0x)/i.test(text)) return Buffer.from(text.replace(/^hex:/i, "").replace(/^0x/i, ""), "hex");
  return Buffer.from(text, "utf8");
}

function hasValue(value) {
  return value != null && String(value).trim() !== "";
}

function getPaymentLinkSecret(env) {
  return String(env.PAYMENT_LINK_SECRET ?? env.ADMIN_JWT_SECRET ?? "vireon-dev-payment-link-secret-change-me");
}

function getMockSignatureSecret(env) {
  return String(env.WALLET_MOCK_SIGNATURE_SECRET ?? env.ADMIN_JWT_SECRET ?? "vireon-dev-wallet-signature-secret");
}

function getPublicBaseUrl(env) {
  return env.PUBLIC_BASE_URL ?? env.ADMIN_PUBLIC_URL ?? `http://${env.ADMIN_PANEL_HOST ?? "127.0.0.1"}:${env.ADMIN_PANEL_PORT ?? "8787"}`;
}

function challengeId({ guildId, userId, address }) {
  return crypto.createHash("sha256").update(`${guildId}:${userId}:${address}`).digest("hex");
}

function normalizeAddress(address) {
  return String(address ?? "").trim();
}

export function parseAssetAmountToUnits(value) {
  const text = String(value ?? "").trim();
  if (!/^\d+(\.\d{1,8})?$/.test(text)) return -1n;
  const [whole, fraction = ""] = text.split(".");
  return BigInt(whole) * 100000000n + BigInt(fraction.padEnd(8, "0"));
}

export function formatAssetUnits(units) {
  const sign = units < 0n ? "-" : "";
  const absolute = units < 0n ? -units : units;
  const whole = absolute / 100000000n;
  const fraction = String(absolute % 100000000n).padStart(8, "0").replace(/0+$/, "");
  return `${sign}${whole}${fraction ? `.${fraction}` : ""}`;
}

function sanitizeWallet(wallet) {
  return {
    id: wallet.id,
    discordUserId: wallet.discordUserId,
    custodyMode: wallet.custodyMode,
    address: wallet.address,
    externalAddress: wallet.externalAddress,
    dailyLimit: wallet.dailyLimit,
    balanceLimit: wallet.balanceLimit,
    createdAt: toIsoString(wallet.createdAt),
    updatedAt: toIsoString(wallet.updatedAt)
  };
}

function sanitizeTransaction(transaction) {
  return {
    id: transaction.id,
    type: transaction.type,
    status: transaction.status,
    amount: transaction.amount,
    asset: transaction.asset,
    fromAddress: transaction.fromAddress,
    toAddress: transaction.toAddress,
    txHash: transaction.txHash,
    createdAt: toIsoString(transaction.createdAt),
    updatedAt: toIsoString(transaction.updatedAt)
  };
}

function serializeWallet(wallet) {
  return {
    ...wallet,
    createdAt: toIsoString(wallet.createdAt),
    updatedAt: toIsoString(wallet.updatedAt)
  };
}

function serializeBalance(balance) {
  return {
    ...balance,
    createdAt: toIsoString(balance.createdAt),
    updatedAt: toIsoString(balance.updatedAt)
  };
}

function serializeTransaction(transaction) {
  return {
    ...transaction,
    createdAt: toIsoString(transaction.createdAt),
    updatedAt: toIsoString(transaction.updatedAt)
  };
}

function toIsoString(value) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function formatInlineCode(value) {
  return `\`${String(value ?? "").slice(0, 1000)}\``;
}

function renderHtmlPage(title, body) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    body { margin: 0; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #080808; color: #f5f1e7; }
    main { width: min(960px, calc(100% - 32px)); margin: 0 auto; padding: 48px 0; }
    .hero { border-bottom: 1px solid rgba(212, 175, 55, .35); padding-bottom: 24px; margin-bottom: 24px; }
    span { color: #d4af37; text-transform: uppercase; font-size: 12px; letter-spacing: .12em; }
    h1 { font-size: clamp(24px, 5vw, 42px); overflow-wrap: anywhere; margin: 8px 0; }
    h2 { margin-top: 32px; }
    p { color: #c8c0ad; }
    table { width: 100%; border-collapse: collapse; background: #111; border: 1px solid rgba(255,255,255,.08); }
    th, td { padding: 12px; border-bottom: 1px solid rgba(255,255,255,.08); text-align: left; }
    th { color: #d4af37; font-size: 12px; text-transform: uppercase; }
  </style>
</head>
<body>${body}</body>
</html>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#039;");
}
