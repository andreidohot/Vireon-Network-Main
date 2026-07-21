import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType
} from "discord.js";
import { writeAuditLog } from "./audit-log.js";
import { createVireonEmbed } from "./embed-factory.js";
import { getSettings } from "./config.js";

const PROPOSALS_COLLECTION = "proposals";
const VOTES_COLLECTION = "proposal-votes";

export function registerProposalHandlers({ store, permissions }) {
  return async function handleProposalInteraction(interaction) {
    if (interaction.isButton() && interaction.customId.startsWith("vireon_proposal_vote:")) {
      await handleProposalVote(interaction, store);
      return true;
    }

    if (!interaction.isChatInputCommand() || interaction.commandName !== "proposal") {
      return false;
    }

    const subcommand = interaction.options.getSubcommand(true);

    if (subcommand === "create") {
      await createProposal(interaction, store);
      return true;
    }

    if (subcommand === "list") {
      await listProposals(interaction, store);
      return true;
    }

    if (subcommand === "close") {
      await closeProposal(interaction, store, permissions);
      return true;
    }

    return false;
  };
}

async function createProposal(interaction, store) {
  const title = interaction.options.getString("title", true);
  const summary = interaction.options.getString("summary", true);
  const type = interaction.options.getString("type", false) ?? "community";
  const settings = await getSettings(store);
  const channel = interaction.guild.channels.cache.find(
    (item) => item.type === ChannelType.GuildText && item.name === (settings.proposals?.defaultChannelName ?? "proposals")
  );

  if (!channel) {
    await interaction.reply({ ephemeral: true, content: "No proposals channel found. Run setup or create #proposals." });
    return;
  }

  const proposal = await store.add(PROPOSALS_COLLECTION, {
    title,
    summary,
    type,
    status: "open",
    authorUserId: interaction.user.id,
    authorTag: interaction.user.tag,
    yes: 0,
    no: 0
  });

  const message = await channel.send({
    embeds: [proposalEmbed(proposal)],
    components: [proposalVoteButtons(proposal.id)]
  });

  await store.update(
    PROPOSALS_COLLECTION,
    (item) => item.id === proposal.id,
    () => ({ channelId: channel.id, messageId: message.id })
  );

  await writeAuditLog(interaction.guild, {
    title: "Proposal Created",
    description: `${proposal.title} by ${interaction.user.tag}`,
    color: 0x9b51e0,
    type: "proposal-created",
    source: "proposal",
    actorUserId: interaction.user.id,
    actorTag: interaction.user.tag,
    channelId: channel.id,
    relatedId: proposal.id,
    metadata: { proposalType: type, title, messageId: message.id }
  }, { store });

  await interaction.reply({ ephemeral: true, content: `Proposal created in #${channel.name}. ID: ${proposal.id}` });
}

async function handleProposalVote(interaction, store) {
  const [, proposalId, vote] = interaction.customId.split(":");
  const proposals = await store.list(PROPOSALS_COLLECTION);
  const proposal = proposals.find((item) => item.id === proposalId);

  if (!proposal || proposal.status !== "open") {
    await interaction.reply({ ephemeral: true, content: "This proposal is not open." });
    return;
  }

  const existingVote = (await store.list(VOTES_COLLECTION)).find(
    (item) => item.proposalId === proposalId && item.userId === interaction.user.id
  );

  if (existingVote) {
    await interaction.reply({ ephemeral: true, content: "You already voted on this proposal." });
    return;
  }

  await store.add(VOTES_COLLECTION, {
    proposalId,
    vote,
    userId: interaction.user.id,
    userTag: interaction.user.tag
  });

  const updated = await store.update(
    PROPOSALS_COLLECTION,
    (item) => item.id === proposalId,
    (item) => ({ [vote]: (item[vote] ?? 0) + 1 })
  );

  await interaction.update({
    embeds: [proposalEmbed(updated)],
    components: [proposalVoteButtons(proposalId)]
  });
}

async function listProposals(interaction, store) {
  const items = (await store.list(PROPOSALS_COLLECTION)).slice(-10).reverse();

  await interaction.reply({
    ephemeral: true,
    embeds: [
      createVireonEmbed({
        title: "Recent Proposals",
        description: items.length
          ? items.map((item) => `**${item.id}** | ${item.status} | ${item.yes}/${item.no} | ${item.title}`).join("\n")
          : "No proposals yet.",
        color: 0x9b51e0
      })
    ]
  });
}

async function closeProposal(interaction, store, permissions) {
  if (!permissions.canManageCommunityBot(interaction)) {
    await interaction.reply({ ephemeral: true, content: "Only staff can close proposals." });
    return;
  }

  const proposalId = interaction.options.getString("id", true);
  const updated = await store.update(
    PROPOSALS_COLLECTION,
    (item) => item.id === proposalId,
    () => ({
      status: "closed",
      closedByUserId: interaction.user.id,
      closedByTag: interaction.user.tag,
      closedAt: new Date().toISOString()
    })
  );

  if (!updated) {
    await interaction.reply({ ephemeral: true, content: "Proposal not found." });
    return;
  }

  await interaction.reply({ ephemeral: true, content: `Proposal ${proposalId} closed.` });
}

function proposalEmbed(proposal) {
  return createVireonEmbed({
    title: `Proposal: ${proposal.title}`,
    description: [
      `Type: **${proposal.type}**`,
      `Status: **${proposal.status}**`,
      `Author: ${proposal.authorTag}`,
      "",
      proposal.summary,
      "",
      `Votes: Yes ${proposal.yes ?? 0} / No ${proposal.no ?? 0}`
    ].join("\n"),
    color: 0x9b51e0
  });
}

function proposalVoteButtons(proposalId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`vireon_proposal_vote:${proposalId}:yes`)
      .setLabel("Vote Yes")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`vireon_proposal_vote:${proposalId}:no`)
      .setLabel("Vote No")
      .setStyle(ButtonStyle.Danger)
  );
}
