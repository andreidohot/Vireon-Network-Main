import crypto from "node:crypto";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { createVireonEmbed } from "./embed-factory.js";
import {
  DEFAULT_PAYMENT_ASSET,
  formatAssetUnits,
  parseAssetAmountToUnits
} from "./wallet-registration.js";

export const PENDING_PAYMENTS_COLLECTION = "pending-payments";

const PAYMENT_CONFIRM_TTL_MS = 2 * 60 * 1000;
const PAYMENT_BUTTON_PREFIX = "vireon_payment";

export function registerPaymentHandlers({ store, walletRegistration, chainClient }) {
  const service = new PaymentService({
    store,
    ledgerStore: walletRegistration.ledgerStore,
    chainClient
  });

  return async function handlePaymentInteraction(interaction) {
    if (interaction.isChatInputCommand() && interaction.commandName === "payment") {
      await handlePaymentCommand(interaction, { service });
      return true;
    }

    if (interaction.isButton() && interaction.customId.startsWith(`${PAYMENT_BUTTON_PREFIX}:`)) {
      await handlePaymentButton(interaction, { service });
      return true;
    }

    return false;
  };
}

export class PaymentService {
  constructor({ store, ledgerStore, chainClient, now = () => new Date() }) {
    this.store = store;
    this.ledgerStore = ledgerStore;
    this.chainClient = chainClient;
    this.now = now;
  }

  async preparePayment({ guildId, senderUser, recipientUser, amount, asset = DEFAULT_PAYMENT_ASSET }) {
    const normalizedAsset = normalizeAsset(asset);
    const amountUnits = parsePositiveAmount(amount, "Payment amount");
    const senderId = senderUser.id;
    const recipientId = recipientUser.id;

    if (senderId === recipientId) {
      throw userError("You cannot send a payment to yourself.");
    }
    if (recipientUser.bot) {
      throw userError("Payments to bot accounts are not supported.");
    }

    const senderWallet = await this.ledgerStore.findWalletByDiscordUserId(senderId);
    if (!senderWallet) {
      throw userError("You need a registered Vireon wallet first. Run `/register custodial`.");
    }
    if (senderWallet.custodyMode !== "custodial") {
      throw userError("Your linked wallet is external. `/payment` can only sign server-side payments from custodial wallets; use your external wallet app for this transfer.");
    }

    const recipientWallet = await this.ledgerStore.findWalletByDiscordUserId(recipientId);
    if (!recipientWallet) {
      throw userError("The recipient does not have a registered Vireon wallet yet. Ask them to run `/register custodial` or `/register external`.");
    }

    const fee = await this.chainClient.estimatePaymentFee({
      fromAddress: senderWallet.address,
      toAddress: recipientWallet.address,
      amount: formatAssetUnits(amountUnits),
      asset: normalizedAsset,
      custodyMode: senderWallet.custodyMode,
      signingMode: "custodial-hd-env-master"
    });
    if (!fee.ok) {
      throw userError(fee.message ?? "Fee estimation failed. Check the Vireon chain adapter configuration.");
    }

    const feeAsset = normalizeAsset(fee.feeAsset ?? normalizedAsset);
    const feeUnits = parsePositiveOrZeroAmount(fee.feeAmount ?? "0", "Payment fee");
    await this.assertSufficientFunds({
      walletId: senderWallet.id,
      asset: normalizedAsset,
      amountUnits,
      feeAsset,
      feeUnits
    });

    const pendingPayment = await this.store.add(PENDING_PAYMENTS_COLLECTION, {
      id: `payment_${crypto.randomUUID()}`,
      guildId,
      senderId,
      senderTag: senderUser.tag ?? senderUser.username ?? senderId,
      recipientId,
      recipientTag: recipientUser.tag ?? recipientUser.username ?? recipientId,
      senderWalletId: senderWallet.id,
      senderAddress: senderWallet.address,
      recipientWalletId: recipientWallet.id,
      recipientAddress: recipientWallet.address,
      amount: formatAssetUnits(amountUnits),
      asset: normalizedAsset,
      amountUnits: amountUnits.toString(),
      feeAmount: formatAssetUnits(feeUnits),
      feeAsset,
      feeUnits: feeUnits.toString(),
      feeSource: fee.source ?? null,
      feeMock: Boolean(fee.mock),
      status: "awaiting_confirmation",
      expiresAt: new Date(this.now().getTime() + PAYMENT_CONFIRM_TTL_MS).toISOString()
    });

    return {
      ok: true,
      payment: pendingPayment,
      senderWallet,
      recipientWallet
    };
  }

  async confirmPayment(paymentId, userId) {
    const payment = await this.getPendingPayment(paymentId);
    this.assertPaymentOwner(payment, userId);
    this.assertPaymentStillConfirmable(payment);

    const amountUnits = BigInt(payment.amountUnits);
    const feeUnits = BigInt(payment.feeUnits);
    await this.assertSufficientFunds({
      walletId: payment.senderWalletId,
      asset: payment.asset,
      amountUnits,
      feeAsset: payment.feeAsset,
      feeUnits
    });

    await this.updatePendingPayment(payment.id, {
      status: "broadcast_pending",
      confirmedAt: this.now().toISOString()
    });
    const sentTransaction = await this.ledgerStore.addTransaction({
      id: `tx_${crypto.randomUUID()}`,
      walletId: payment.senderWalletId,
      type: "payment_sent",
      status: "broadcast_pending",
      amount: payment.amount,
      asset: payment.asset,
      fromAddress: payment.senderAddress,
      toAddress: payment.recipientAddress,
      metadata: JSON.stringify({
        paymentId: payment.id,
        recipientUserId: payment.recipientId,
        feeAmount: payment.feeAmount,
        feeAsset: payment.feeAsset
      })
    });

    const broadcast = await this.chainClient.broadcastPayment({
      fromAddress: payment.senderAddress,
      toAddress: payment.recipientAddress,
      amount: payment.amount,
      asset: payment.asset,
      feeAmount: payment.feeAmount,
      feeAsset: payment.feeAsset,
      referenceId: payment.id,
      custodyMode: "custodial",
      signingMode: "custodial-hd-env-master"
    });

    if (!broadcast.ok) {
      await this.ledgerStore.updateTransaction(sentTransaction.id, {
        status: "broadcast_failed",
        metadata: JSON.stringify({
          paymentId: payment.id,
          recipientUserId: payment.recipientId,
          feeAmount: payment.feeAmount,
          feeAsset: payment.feeAsset,
          broadcastStatus: broadcast.status,
          broadcastError: broadcast.message ?? broadcast.error ?? null
        })
      });
      await this.updatePendingPayment(payment.id, {
        status: "broadcast_failed",
        broadcastStatus: broadcast.status,
        broadcastError: broadcast.message ?? broadcast.error ?? "Broadcast failed.",
        failedAt: this.now().toISOString()
      });

      return {
        ok: false,
        payment: {
          ...payment,
          status: "broadcast_failed"
        },
        broadcast,
        senderTransaction: sentTransaction
      };
    }

    const finalStatus = broadcast.mock ? "broadcast_mock" : "broadcasted";
    await this.applyLocalBalanceSync({ payment, amountUnits, feeUnits });
    const updatedSentTransaction = await this.ledgerStore.updateTransaction(sentTransaction.id, {
      status: finalStatus,
      txHash: broadcast.txHash,
      metadata: JSON.stringify({
        paymentId: payment.id,
        recipientUserId: payment.recipientId,
        feeAmount: payment.feeAmount,
        feeAsset: payment.feeAsset,
        broadcastStatus: broadcast.status,
        broadcastMock: Boolean(broadcast.mock)
      })
    });
    const receivedTransaction = await this.ledgerStore.addTransaction({
      id: `tx_${crypto.randomUUID()}`,
      walletId: payment.recipientWalletId,
      type: "payment_received",
      status: finalStatus,
      amount: payment.amount,
      asset: payment.asset,
      fromAddress: payment.senderAddress,
      toAddress: payment.recipientAddress,
      txHash: broadcast.txHash,
      metadata: JSON.stringify({
        paymentId: payment.id,
        senderUserId: payment.senderId
      })
    });
    let feeTransaction = null;
    if (feeUnits > 0n) {
      feeTransaction = await this.ledgerStore.addTransaction({
        id: `tx_${crypto.randomUUID()}`,
        walletId: payment.senderWalletId,
        type: "payment_fee",
        status: finalStatus,
        amount: payment.feeAmount,
        asset: payment.feeAsset,
        fromAddress: payment.senderAddress,
        txHash: broadcast.txHash,
        metadata: JSON.stringify({
          paymentId: payment.id
        })
      });
    }

    await this.updatePendingPayment(payment.id, {
      status: finalStatus,
      txHash: broadcast.txHash,
      broadcastStatus: broadcast.status,
      broadcastMock: Boolean(broadcast.mock),
      completedAt: this.now().toISOString()
    });

    return {
      ok: true,
      payment: {
        ...payment,
        status: finalStatus,
        txHash: broadcast.txHash
      },
      broadcast,
      senderTransaction: updatedSentTransaction,
      recipientTransaction: receivedTransaction,
      feeTransaction
    };
  }

  async cancelPayment(paymentId, userId) {
    const payment = await this.getPendingPayment(paymentId);
    this.assertPaymentOwner(payment, userId);
    this.assertPaymentStillConfirmable(payment);

    const updated = await this.updatePendingPayment(payment.id, {
      status: "cancelled",
      cancelledAt: this.now().toISOString()
    });

    return {
      ok: true,
      payment: updated
    };
  }

  async assertSufficientFunds({ walletId, asset, amountUnits, feeAsset, feeUnits }) {
    const balances = await this.ledgerStore.listBalances(walletId);
    const paymentBalance = balances.find((balance) => balance.asset === asset)
      ?? await this.ledgerStore.ensureBalance(walletId, asset);
    const availablePaymentUnits = parseAssetAmountToUnits(paymentBalance.available);
    const requiredPaymentUnits = feeAsset === asset ? amountUnits + feeUnits : amountUnits;
    if (availablePaymentUnits < requiredPaymentUnits) {
      throw userError(`Insufficient available balance. Required ${formatAssetUnits(requiredPaymentUnits)} ${asset}.`);
    }

    if (feeAsset !== asset && feeUnits > 0n) {
      const feeBalance = balances.find((balance) => balance.asset === feeAsset)
        ?? await this.ledgerStore.ensureBalance(walletId, feeAsset);
      const availableFeeUnits = parseAssetAmountToUnits(feeBalance.available);
      if (availableFeeUnits < feeUnits) {
        throw userError(`Insufficient available balance for network fee. Required ${formatAssetUnits(feeUnits)} ${feeAsset}.`);
      }
    }
  }

  async applyLocalBalanceSync({ payment, amountUnits, feeUnits }) {
    const senderBalances = await this.ledgerStore.listBalances(payment.senderWalletId);
    const recipientBalances = await this.ledgerStore.listBalances(payment.recipientWalletId);
    const senderPaymentBalance = senderBalances.find((balance) => balance.asset === payment.asset)
      ?? await this.ledgerStore.ensureBalance(payment.senderWalletId, payment.asset);
    const recipientBalance = recipientBalances.find((balance) => balance.asset === payment.asset)
      ?? await this.ledgerStore.ensureBalance(payment.recipientWalletId, payment.asset);
    const senderPaymentAvailable = parseAssetAmountToUnits(senderPaymentBalance.available);
    const recipientAvailable = parseAssetAmountToUnits(recipientBalance.available);
    const paymentDeduction = payment.feeAsset === payment.asset ? amountUnits + feeUnits : amountUnits;

    await this.ledgerStore.updateBalance(payment.senderWalletId, payment.asset, {
      available: formatAssetUnits(senderPaymentAvailable - paymentDeduction)
    });
    await this.ledgerStore.updateBalance(payment.recipientWalletId, payment.asset, {
      available: formatAssetUnits(recipientAvailable + amountUnits)
    });

    if (payment.feeAsset !== payment.asset && feeUnits > 0n) {
      const senderFeeBalance = senderBalances.find((balance) => balance.asset === payment.feeAsset)
        ?? await this.ledgerStore.ensureBalance(payment.senderWalletId, payment.feeAsset);
      const senderFeeAvailable = parseAssetAmountToUnits(senderFeeBalance.available);
      await this.ledgerStore.updateBalance(payment.senderWalletId, payment.feeAsset, {
        available: formatAssetUnits(senderFeeAvailable - feeUnits)
      });
    }
  }

  async getPendingPayment(paymentId) {
    const payments = await this.store.list(PENDING_PAYMENTS_COLLECTION);
    return payments.find((payment) => payment.id === paymentId) ?? null;
  }

  async updatePendingPayment(paymentId, updates) {
    return this.store.update(PENDING_PAYMENTS_COLLECTION, (payment) => payment.id === paymentId, () => updates);
  }

  assertPaymentOwner(payment, userId) {
    if (!payment) {
      throw userError("Payment confirmation not found or expired.");
    }
    if (payment.senderId !== userId) {
      throw userError("Only the sender can confirm or cancel this payment.");
    }
  }

  assertPaymentStillConfirmable(payment) {
    if (payment.status !== "awaiting_confirmation") {
      throw userError(`This payment is already ${payment.status}.`);
    }
    if (Date.parse(payment.expiresAt) < this.now().getTime()) {
      throw userError("This payment confirmation expired. Run `/payment` again.");
    }
  }
}

async function handlePaymentCommand(interaction, { service }) {
  await interaction.deferReply({ ephemeral: true });
  const recipient = interaction.options.getUser("user", true);
  const amount = interaction.options.getString("amount", true);
  const asset = interaction.options.getString("asset", false) ?? DEFAULT_PAYMENT_ASSET;

  try {
    const prepared = await service.preparePayment({
      guildId: interaction.guildId,
      senderUser: interaction.user,
      recipientUser: recipient,
      amount,
      asset
    });

    await interaction.editReply({
      embeds: [buildPaymentConfirmationEmbed(prepared.payment, recipient)],
      components: [buildPaymentButtons(prepared.payment.id)]
    });
  } catch (error) {
    await interaction.editReply({
      embeds: [buildPaymentErrorEmbed(error.message)]
    });
  }
}

async function handlePaymentButton(interaction, { service }) {
  const [, action, paymentId] = interaction.customId.split(":");
  if (!paymentId || !["confirm", "cancel"].includes(action)) {
    await interaction.reply({ ephemeral: true, content: "Unknown payment action." });
    return;
  }

  try {
    const payment = await service.getPendingPayment(paymentId);
    if (payment && payment.senderId !== interaction.user.id) {
      await interaction.reply({ ephemeral: true, content: "Only the sender can use this payment confirmation." });
      return;
    }

    await interaction.deferUpdate();

    if (action === "cancel") {
      const cancelled = await service.cancelPayment(paymentId, interaction.user.id);
      await interaction.editReply({
        embeds: [buildPaymentCancelledEmbed(cancelled.payment)],
        components: []
      });
      return;
    }

    const result = await service.confirmPayment(paymentId, interaction.user.id);
    await interaction.editReply({
      embeds: [buildPaymentResultEmbed(result)],
      components: []
    });
    if (result.ok) {
      await notifyPaymentParticipants(interaction, result.payment);
    }
  } catch (error) {
    await interaction.editReply({
      embeds: [buildPaymentErrorEmbed(error.message)],
      components: []
    });
  }
}

function buildPaymentButtons(paymentId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${PAYMENT_BUTTON_PREFIX}:confirm:${paymentId}`)
      .setLabel("Confirm")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`${PAYMENT_BUTTON_PREFIX}:cancel:${paymentId}`)
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Secondary)
  );
}

function buildPaymentConfirmationEmbed(payment, recipient) {
  return createVireonEmbed({
    title: "Confirm Vireon Payment",
    description: [
      `Send **${payment.amount} ${payment.asset}** to <@${payment.recipientId}>?`,
      "",
      `Estimated network fee: **${payment.feeAmount} ${payment.feeAsset}**`,
      payment.feeMock ? "Fee is from the mock chain adapter." : "Fee is estimated by the configured Vireon chain adapter.",
      "",
      "Confirming will sign/broadcast through the chain adapter, then sync local ledger balances."
    ].join("\n"),
    color: 0xd4af37,
    fields: [
      { name: "Recipient", value: `<@${recipient.id}>`, inline: true },
      { name: "Recipient wallet", value: formatAddress(payment.recipientAddress), inline: false },
      { name: "Expires", value: payment.expiresAt, inline: true }
    ],
    footer: "Vireon Payments | Confirm or cancel"
  });
}

function buildPaymentResultEmbed(result) {
  const payment = result.payment;
  if (!result.ok) {
    return createVireonEmbed({
      title: "Vireon Payment Broadcast Failed",
      description: [
        `Payment to <@${payment.recipientId}> was not applied to local balances.`,
        result.broadcast.message ?? result.broadcast.error ?? `Broadcast status: ${result.broadcast.status}`
      ].join("\n"),
      color: 0x8b1e24,
      fields: [
        { name: "Amount", value: `${payment.amount} ${payment.asset}`, inline: true },
        { name: "Fee", value: `${payment.feeAmount} ${payment.feeAsset}`, inline: true }
      ],
      footer: "Vireon Payments | No local balance change"
    });
  }

  return createVireonEmbed({
    title: result.broadcast.mock ? "Vireon Payment Simulated" : "Vireon Payment Sent",
    description: [
      `Sent **${payment.amount} ${payment.asset}** to <@${payment.recipientId}>.`,
      result.broadcast.mock ? "Mock adapter active. This is not a mainnet transaction." : "Broadcast accepted by the configured Vireon chain adapter."
    ].join("\n"),
    color: 0xd4af37,
    fields: [
      { name: "Fee", value: `${payment.feeAmount} ${payment.feeAsset}`, inline: true },
      { name: "Status", value: payment.status, inline: true },
      { name: "Tx hash", value: formatHash(payment.txHash), inline: false }
    ],
    footer: "Vireon Payments | Local ledger synchronized"
  });
}

function buildPaymentCancelledEmbed(payment) {
  return createVireonEmbed({
    title: "Vireon Payment Cancelled",
    description: `Payment of ${payment.amount} ${payment.asset} to <@${payment.recipientId}> was cancelled.`,
    color: 0x8b1e24,
    footer: "Vireon Payments"
  });
}

function buildPaymentErrorEmbed(message) {
  return createVireonEmbed({
    title: "Vireon Payment",
    description: message,
    color: 0x8b1e24,
    footer: "Vireon Payments | Action required"
  });
}

async function notifyPaymentParticipants(interaction, payment) {
  const senderMessage = [
    `Vireon payment sent: ${payment.amount} ${payment.asset} to <@${payment.recipientId}>.`,
    `Tx: ${payment.txHash}`
  ].join("\n");
  const recipientMessage = [
    `You received ${payment.amount} ${payment.asset} from <@${payment.senderId}>.`,
    `Tx: ${payment.txHash}`
  ].join("\n");

  await Promise.allSettled([
    interaction.client.users.fetch(payment.senderId).then((user) => user.send(senderMessage)),
    interaction.client.users.fetch(payment.recipientId).then((user) => user.send(recipientMessage))
  ]);
}

function parsePositiveAmount(value, label) {
  const units = parseAssetAmountToUnits(value);
  if (units <= 0n) {
    throw userError(`${label} must be greater than zero and use up to 8 decimals.`);
  }
  return units;
}

function parsePositiveOrZeroAmount(value, label) {
  const units = parseAssetAmountToUnits(value);
  if (units < 0n) {
    throw userError(`${label} must use up to 8 decimals.`);
  }
  return units;
}

function normalizeAsset(asset) {
  return String(asset ?? DEFAULT_PAYMENT_ASSET).trim().toUpperCase() || DEFAULT_PAYMENT_ASSET;
}

function formatAddress(address) {
  const value = String(address ?? "");
  if (value.length <= 32) return `\`${value}\``;
  return `\`${value.slice(0, 14)}...${value.slice(-12)}\``;
}

function formatHash(hash) {
  if (!hash) return "Unavailable";
  const value = String(hash);
  if (value.length <= 80) return `\`${value}\``;
  return `\`${value.slice(0, 36)}...${value.slice(-18)}\``;
}

function userError(message) {
  const error = new Error(message);
  error.userFacing = true;
  return error;
}
