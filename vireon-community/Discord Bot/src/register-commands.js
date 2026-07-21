import "dotenv/config";
import { ChannelType, REST, Routes, SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import { childLogger } from "./logger.js";

const logger = childLogger({ module: "register-commands" });

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID;

if (!token || !clientId || !guildId) {
  throw new Error("Missing DISCORD_TOKEN, DISCORD_CLIENT_ID or DISCORD_GUILD_ID.");
}

const commands = [
  new SlashCommandBuilder()
    .setName("setup-vireon")
    .setDescription("Create or update the Vireon Discord server structure.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addBooleanOption((option) =>
      option
        .setName("confirm")
        .setDescription("Must be true to apply the setup.")
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("template")
        .setDescription("Server template to preview or apply.")
        .addChoices(
          { name: "Starter", value: "starter" },
          { name: "Community", value: "community" },
          { name: "Developer", value: "developer" },
          { name: "Gaming", value: "gaming" },
          { name: "Ultimate", value: "ultimate" }
        )
    )
    .addBooleanOption((option) =>
      option
        .setName("include_rank_roles")
        .setDescription("Also create optional VBOS XP rank roles.")
    ),
  new SlashCommandBuilder()
    .setName("vireon-status")
    .setDescription("Show live Vireon Network status from the configured chain adapter."),
  new SlashCommandBuilder()
    .setName("register")
    .setDescription("Create or link a Vireon wallet for rewards and payments.")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("custodial")
        .setDescription("Create a custodial Vireon wallet with an encrypted server-side seed.")
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("external")
        .setDescription("Start challenge-response linking for an external Vireon wallet.")
        .addStringOption((option) =>
          option
            .setName("address")
            .setDescription("External Vireon wallet address to link.")
            .setMinLength(8)
            .setMaxLength(160)
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("verify")
        .setDescription("Verify an external wallet challenge signature.")
        .addStringOption((option) =>
          option
            .setName("address")
            .setDescription("External Vireon wallet address from /register external.")
            .setMinLength(8)
            .setMaxLength(160)
            .setRequired(true)
        )
        .addStringOption((option) =>
          option
            .setName("signature")
            .setDescription("Signature for the challenge message.")
            .setMinLength(8)
            .setMaxLength(512)
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("status")
        .setDescription("Show your linked Vireon wallet and payment link.")
    ),
  new SlashCommandBuilder()
    .setName("rewards")
    .setDescription("Show mining, staking and node rewards for a linked Vireon wallet.")
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("Optional member to inspect.")
        .setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName("payment")
    .setDescription("Send VIRE to another registered Vireon wallet with confirmation.")
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("Registered recipient.")
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("amount")
        .setDescription("Amount to send, up to 8 decimals.")
        .setMinLength(1)
        .setMaxLength(40)
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("asset")
        .setDescription("Asset symbol. Defaults to VIRE.")
        .setMaxLength(16)
        .setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName("rank")
    .setDescription("Show your Vireon XP rank card.")
    .addUserOption((option) =>
      option
        .setName("member")
        .setDescription("Select a server member to inspect. Leave empty for yourself.")
        .setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("Show the Vireon XP leaderboard.")
    .addIntegerOption((option) =>
      option
        .setName("limit")
        .setDescription("Number of members to show.")
        .setMinValue(3)
        .setMaxValue(25)
        .setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName("daily")
    .setDescription("Claim your daily server-only Shards reward. Shards are not VIRE."),
  new SlashCommandBuilder()
    .setName("work")
    .setDescription("Do a community work action for server-only Shards."),
  new SlashCommandBuilder()
    .setName("balance")
    .setDescription("Show a member's internal Shards balance.")
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("Optional member to inspect.")
        .setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName("leaderboard-economy")
    .setDescription("Show the internal Shards economy leaderboard.")
    .addIntegerOption((option) =>
      option
        .setName("limit")
        .setDescription("Number of members to show.")
        .setMinValue(3)
        .setMaxValue(25)
        .setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName("shop")
    .setDescription("Browse or buy cosmetic roles with server-only Shards.")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("list")
        .setDescription("List cosmetic role shop items.")
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("buy")
        .setDescription("Buy a cosmetic role from the Shards shop.")
        .addStringOption((option) =>
          option
            .setName("item_id")
            .setDescription("Shop item id from /shop list.")
            .setMaxLength(40)
            .setRequired(true)
        )
    ),
  new SlashCommandBuilder()
    .setName("tag")
    .setDescription("Create, list, use or delete custom community tags.")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("create")
        .setDescription("Create a custom tag. Variables: {user}, {server}, {mentions}.")
        .addStringOption((option) =>
          option
            .setName("name")
            .setDescription("Short tag name.")
            .setMinLength(2)
            .setMaxLength(40)
            .setRequired(true)
        )
        .addStringOption((option) =>
          option
            .setName("content")
            .setDescription("Tag response content.")
            .setMaxLength(1800)
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("list")
        .setDescription("List custom tags for this server.")
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("use")
        .setDescription("Use a custom tag.")
        .addStringOption((option) =>
          option
            .setName("name")
            .setDescription("Tag name.")
            .setMinLength(2)
            .setMaxLength(40)
            .setRequired(true)
        )
        .addStringOption((option) =>
          option
            .setName("mentions")
            .setDescription("Optional text injected into {mentions}.")
            .setMaxLength(200)
            .setRequired(false)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("delete")
        .setDescription("Delete a custom tag.")
        .addStringOption((option) =>
          option
            .setName("name")
            .setDescription("Tag name.")
            .setMinLength(2)
            .setMaxLength(40)
            .setRequired(true)
        )
    ),

  new SlashCommandBuilder()
    .setName("custom")
    .setDescription("Run a custom command managed from VBOS Admin Web.")
    .addStringOption((option) =>
      option
        .setName("name")
        .setDescription("Custom command name or alias.")
        .setMinLength(2)
        .setMaxLength(32)
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("input")
        .setDescription("Optional input passed to {input}.")
        .setMaxLength(300)
        .setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName("trigger")
    .setDescription("Manage automatic tag responders with simple regex and cooldown.")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("create")
        .setDescription("Create an auto-responder that sends a tag when regex matches.")
        .addStringOption((option) =>
          option
            .setName("name")
            .setDescription("Short trigger name.")
            .setMinLength(2)
            .setMaxLength(40)
            .setRequired(true)
        )
        .addStringOption((option) =>
          option
            .setName("pattern")
            .setDescription("Simple regex pattern, case-insensitive.")
            .setMaxLength(200)
            .setRequired(true)
        )
        .addStringOption((option) =>
          option
            .setName("tag")
            .setDescription("Existing tag name to send as the response.")
            .setMinLength(2)
            .setMaxLength(40)
            .setRequired(true)
        )
        .addIntegerOption((option) =>
          option
            .setName("cooldown_seconds")
            .setDescription("Global cooldown for this trigger.")
            .setMinValue(0)
            .setMaxValue(86400)
            .setRequired(false)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("list")
        .setDescription("List active custom auto-responders.")
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("delete")
        .setDescription("Delete an auto-responder.")
        .addStringOption((option) =>
          option
            .setName("name")
            .setDescription("Trigger name.")
            .setMinLength(2)
            .setMaxLength(40)
            .setRequired(true)
        )
    ),
  new SlashCommandBuilder()
    .setName("shards")
    .setDescription("Server-only social currency commands. Shards are not VIRE.")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("balance")
        .setDescription("Show a member's Shards balance.")
        .addUserOption((option) =>
          option
            .setName("user")
            .setDescription("Optional member to inspect.")
            .setRequired(false)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("leaderboard")
        .setDescription("Show the Shards leaderboard.")
        .addIntegerOption((option) =>
          option
            .setName("limit")
            .setDescription("Number of members to show.")
            .setMinValue(3)
            .setMaxValue(25)
            .setRequired(false)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("transfer")
        .setDescription("Transfer server-only Shards to another member.")
        .addUserOption((option) =>
          option.setName("user").setDescription("Member to receive Shards.").setRequired(true)
        )
        .addIntegerOption((option) =>
          option.setName("amount").setDescription("Amount of Shards to transfer.").setMinValue(1).setRequired(true)
        )
        .addStringOption((option) =>
          option.setName("reason").setDescription("Optional reason.").setMaxLength(200).setRequired(false)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("grant")
        .setDescription("Staff: grant server-only Shards to a member.")
        .addUserOption((option) =>
          option.setName("user").setDescription("Member to receive Shards.").setRequired(true)
        )
        .addIntegerOption((option) =>
          option.setName("amount").setDescription("Amount of Shards to grant.").setMinValue(1).setRequired(true)
        )
        .addStringOption((option) =>
          option.setName("reason").setDescription("Reason for the grant.").setMaxLength(200).setRequired(false)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("take")
        .setDescription("Staff: remove server-only Shards from a member.")
        .addUserOption((option) =>
          option.setName("user").setDescription("Member to update.").setRequired(true)
        )
        .addIntegerOption((option) =>
          option.setName("amount").setDescription("Amount of Shards to remove.").setMinValue(1).setRequired(true)
        )
        .addStringOption((option) =>
          option.setName("reason").setDescription("Reason for removal.").setMaxLength(200).setRequired(false)
        )
    ),
  new SlashCommandBuilder()
    .setName("send-embed")
    .setDescription("Send a VBOS-styled embed to a channel.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption((option) =>
      option
        .setName("channel")
        .setDescription("Target text channel.")
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("title")
        .setDescription("Embed title.")
        .setMaxLength(120)
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("description")
        .setDescription("Embed body text.")
        .setMaxLength(2000)
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("color")
        .setDescription("Optional hex color, for example #d4af37.")
        .setMaxLength(7)
        .setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName("warn")
    .setDescription("Log a warning for a member.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((option) =>
      option.setName("user").setDescription("Member to warn.").setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("reason")
        .setDescription("Reason for the warning.")
        .setMaxLength(500)
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("mute")
    .setDescription("Timeout a member for a number of minutes.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((option) =>
      option.setName("user").setDescription("Member to mute.").setRequired(true)
    )
    .addIntegerOption((option) =>
      option
        .setName("minutes")
        .setDescription("Timeout duration in minutes.")
        .setMinValue(1)
        .setMaxValue(40320)
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("reason")
        .setDescription("Reason for the mute.")
        .setMaxLength(500)
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("unmute")
    .setDescription("Remove timeout from a member.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((option) =>
      option.setName("user").setDescription("Member to unmute.").setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("reason")
        .setDescription("Reason for the unmute.")
        .setMaxLength(500)
        .setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName("kick")
    .setDescription("Kick a member from the server.")
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addUserOption((option) =>
      option.setName("user").setDescription("Member to kick.").setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("reason")
        .setDescription("Reason for the kick.")
        .setMaxLength(500)
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("ban")
    .setDescription("Ban a user from the server.")
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption((option) =>
      option.setName("user").setDescription("User to ban.").setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("reason")
        .setDescription("Reason for the ban.")
        .setMaxLength(500)
        .setRequired(true)
    )
    .addIntegerOption((option) =>
      option
        .setName("delete_message_days")
        .setDescription("Delete messages from the last N days, 0-7.")
        .setMinValue(0)
        .setMaxValue(7)
        .setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName("purge")
    .setDescription("Delete recent messages from the current channel.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption((option) =>
      option
        .setName("amount")
        .setDescription("Number of recent messages to delete.")
        .setMinValue(1)
        .setMaxValue(100)
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("reason")
        .setDescription("Reason for the purge.")
        .setMaxLength(500)
        .setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName("cases")
    .setDescription("Show recent moderation cases for a member.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((option) =>
      option.setName("user").setDescription("Member to inspect.").setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("ticket")
    .setDescription("Open, close or list support tickets.")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("open")
        .setDescription("Open a private support ticket.")
        .addStringOption((option) =>
          option
            .setName("topic")
            .setDescription("Short ticket topic.")
            .setMaxLength(120)
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("close")
        .setDescription("Close the current ticket.")
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("list")
        .setDescription("List open tickets.")
    ),
  new SlashCommandBuilder()
    .setName("announce")
    .setDescription("Create or publish Vireon announcements.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((subcommand) =>
      subcommand
        .setName("publish")
        .setDescription("Publish an announcement.")
        .addStringOption((option) =>
          option.setName("title").setDescription("Announcement title.").setMaxLength(120).setRequired(true)
        )
        .addStringOption((option) =>
          option.setName("body").setDescription("Announcement body.").setMaxLength(2000).setRequired(true)
        )
        .addStringOption((option) =>
          option
            .setName("status")
            .setDescription("Public status label.")
            .addChoices(
              { name: "Draft", value: "Draft" },
              { name: "Planned", value: "Planned" },
              { name: "Research", value: "Research" },
              { name: "Prototype", value: "Prototype" },
              { name: "Private devnet", value: "Private devnet" },
              { name: "Public testnet", value: "Public testnet" },
              { name: "Mainnet candidate", value: "Mainnet candidate" }
            )
            .setRequired(false)
        )
        .addChannelOption((option) =>
          option
            .setName("channel")
            .setDescription("Optional target channel.")
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(false)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("draft")
        .setDescription("Save an announcement draft.")
        .addStringOption((option) =>
          option.setName("title").setDescription("Draft title.").setMaxLength(120).setRequired(true)
        )
        .addStringOption((option) =>
          option.setName("body").setDescription("Draft body.").setMaxLength(2000).setRequired(true)
        )
        .addStringOption((option) =>
          option.setName("status").setDescription("Status label.").setMaxLength(40).setRequired(false)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("list").setDescription("List recent announcements.")
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("schedule")
        .setDescription("Schedule an announcement for later.")
        .addStringOption((option) =>
          option.setName("title").setDescription("Announcement title.").setMaxLength(120).setRequired(true)
        )
        .addStringOption((option) =>
          option.setName("body").setDescription("Announcement body.").setMaxLength(2000).setRequired(true)
        )
        .addStringOption((option) =>
          option
            .setName("scheduled_at")
            .setDescription("ISO datetime, for example 2026-07-05T12:00:00.000Z.")
            .setRequired(true)
        )
        .addStringOption((option) =>
          option
            .setName("status")
            .setDescription("Status label.")
            .setMaxLength(40)
            .setRequired(false)
        )
        .addChannelOption((option) =>
          option
            .setName("channel")
            .setDescription("Optional target channel.")
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(false)
        )
    ),
  new SlashCommandBuilder()
    .setName("proposal")
    .setDescription("Create, list or close community proposals.")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("create")
        .setDescription("Create a community proposal.")
        .addStringOption((option) =>
          option.setName("title").setDescription("Proposal title.").setMaxLength(120).setRequired(true)
        )
        .addStringOption((option) =>
          option.setName("summary").setDescription("Proposal summary.").setMaxLength(1500).setRequired(true)
        )
        .addStringOption((option) =>
          option
            .setName("type")
            .setDescription("Proposal type.")
            .addChoices(
              { name: "Community", value: "community" },
              { name: "Development", value: "development" },
              { name: "Governance", value: "governance" },
              { name: "Ecosystem", value: "ecosystem" }
            )
            .setRequired(false)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("list").setDescription("List recent proposals.")
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("close")
        .setDescription("Close a proposal.")
        .addStringOption((option) =>
          option.setName("id").setDescription("Proposal ID.").setRequired(true)
        )
    ),
  ...buildStandaloneMusicCommands(),
  new SlashCommandBuilder()
    .setName("playlist")
    .setDescription("Save and play user or server music playlists.")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("create")
        .setDescription("Create a saved music playlist.")
        .addStringOption((option) => addPlaylistNameOption(option))
        .addStringOption((option) => addPlaylistScopeChoices(option, false))
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("list")
        .setDescription("List saved music playlists.")
        .addStringOption((option) => addPlaylistScopeChoices(option, false))
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("show")
        .setDescription("Show tracks saved in a playlist.")
        .addStringOption((option) => addPlaylistNameOption(option))
        .addStringOption((option) => addPlaylistScopeChoices(option, false))
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("add")
        .setDescription("Add a track URL or search query to a saved playlist.")
        .addStringOption((option) => addPlaylistNameOption(option))
        .addStringOption((option) =>
          option
            .setName("query")
            .setDescription("Track URL or search text to save.")
            .setMaxLength(300)
            .setRequired(true)
        )
        .addStringOption((option) =>
          option
            .setName("title")
            .setDescription("Optional display title for this saved track.")
            .setMaxLength(120)
            .setRequired(false)
        )
        .addStringOption((option) => addPlaylistScopeChoices(option, false))
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("remove")
        .setDescription("Remove a track from a saved playlist.")
        .addStringOption((option) => addPlaylistNameOption(option))
        .addIntegerOption((option) =>
          option
            .setName("index")
            .setDescription("Track number from /playlist show.")
            .setMinValue(1)
            .setMaxValue(100)
            .setRequired(true)
        )
        .addStringOption((option) => addPlaylistScopeChoices(option, false))
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("play")
        .setDescription("Queue all playable tracks from a saved playlist.")
        .addStringOption((option) => addPlaylistNameOption(option))
        .addStringOption((option) => addPlaylistScopeChoices(option, false))
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("delete")
        .setDescription("Delete a saved music playlist.")
        .addStringOption((option) => addPlaylistNameOption(option))
        .addStringOption((option) => addPlaylistScopeChoices(option, false))
    ),
  new SlashCommandBuilder()
    .setName("music")
    .setDescription("Control the Vireon community music player.")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("play")
        .setDescription("Play a URL or search query through Lavalink.")
        .addStringOption((option) =>
          option
            .setName("query")
            .setDescription("Track URL or search text.")
            .setMaxLength(300)
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("queue").setDescription("Show the current music queue.")
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("nowplaying").setDescription("Show the current track.")
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("skip").setDescription("Skip the current track.")
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("pause").setDescription("Pause playback.")
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("resume").setDescription("Resume playback.")
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("stop").setDescription("Stop playback and clear the queue.")
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("leave").setDescription("Disconnect from voice.")
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("volume")
        .setDescription("Set playback volume.")
        .addIntegerOption((option) =>
          option
            .setName("percent")
            .setDescription("Volume from 1 to 150.")
            .setMinValue(1)
            .setMaxValue(150)
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("loop")
        .setDescription("Set or cycle loop mode.")
        .addStringOption((option) => addLoopModeChoices(option, false))
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("shuffle").setDescription("Shuffle the queued tracks.")
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("filter")
        .setDescription("Apply an audio filter preset.")
        .addStringOption((option) => addAudioFilterPresetChoices(option, true))
    ),
  new SlashCommandBuilder()
    .setName("vbos")
    .setDescription("VBOS command center: help, dashboard, invite, status and command catalog.")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("help")
        .setDescription("Show the VBOS command map.")
        .addStringOption((option) => addVbosCategoryChoices(option, false))
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("dashboard").setDescription("Show the Admin Web dashboard URL.")
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("invite").setDescription("Show the bot invite link.")
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("status").setDescription("Show VBOS runtime, modules and command stats.")
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("commands")
        .setDescription("List available commands by category.")
        .addStringOption((option) => addVbosCategoryChoices(option, false))
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("quickstart").setDescription("Show a fast operator quickstart.")
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("audit")
        .setDescription("Show recent audited actions. Staff only.")
        .addIntegerOption((option) =>
          option.setName("limit").setDescription("Number of events, max 10.").setMinValue(1).setMaxValue(10).setRequired(false)
        )
    ),
  new SlashCommandBuilder()
    .setName("modules")
    .setDescription("Control VBOS modules from Discord.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((subcommand) =>
      subcommand.setName("list").setDescription("List modules and their state.")
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("status")
        .setDescription("Show one module status.")
        .addStringOption((option) => option.setName("module_id").setDescription("Module ID, for example automations.").setMaxLength(80).setRequired(true))
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("enable")
        .setDescription("Enable an optional module. Admin/staff only.")
        .addStringOption((option) => option.setName("module_id").setDescription("Module ID.").setMaxLength(80).setRequired(true))
        .addStringOption((option) => option.setName("reason").setDescription("Audit reason.").setMaxLength(200).setRequired(false))
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("disable")
        .setDescription("Disable an optional module. Admin/staff only.")
        .addStringOption((option) => option.setName("module_id").setDescription("Module ID.").setMaxLength(80).setRequired(true))
        .addStringOption((option) => option.setName("reason").setDescription("Audit reason.").setMaxLength(200).setRequired(false))
    ),
  new SlashCommandBuilder()
    .setName("automations")
    .setDescription("Inspect and test VBOS automation flows from Discord.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((subcommand) => subcommand.setName("list").setDescription("List automation flows."))
    .addSubcommand((subcommand) =>
      subcommand
        .setName("info")
        .setDescription("Show one automation flow.")
        .addStringOption((option) => option.setName("flow_id").setDescription("Flow ID or exact name.").setMaxLength(120).setRequired(true))
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("events")
        .setDescription("Show recent automation events.")
        .addIntegerOption((option) => option.setName("limit").setDescription("Number of events, max 10.").setMinValue(1).setMaxValue(10).setRequired(false))
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("test")
        .setDescription("Run a safe manual test for one flow.")
        .addStringOption((option) => option.setName("flow_id").setDescription("Flow ID or exact name.").setMaxLength(120).setRequired(true))
        .addBooleanOption((option) => option.setName("dry_run").setDescription("Keep true to avoid posting or mutating roles.").setRequired(false))
    ),
  new SlashCommandBuilder()
    .setName("operations")
    .setDescription("Operate Bot Studio from Discord.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((subcommand) => subcommand.setName("templates").setDescription("List saved message templates."))
    .addSubcommand((subcommand) =>
      subcommand
        .setName("approvals")
        .setDescription("List message approval queue.")
        .addIntegerOption((option) => option.setName("limit").setDescription("Number of items, max 10.").setMinValue(1).setMaxValue(10).setRequired(false))
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("pushes")
        .setDescription("List message push history.")
        .addIntegerOption((option) => option.setName("limit").setDescription("Number of items, max 10.").setMinValue(1).setMaxValue(10).setRequired(false))
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("console")
        .setDescription("Run an allowlisted Bot Studio console command.")
        .addStringOption((option) => option.setName("command").setDescription("Example: status, channels, roles, audit-tail 5.").setMaxLength(500).setRequired(true))
    ),
  new SlashCommandBuilder()
    .setName("server")
    .setDescription("Inspect the Discord server from VBOS.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((subcommand) => subcommand.setName("info").setDescription("Show server info."))
    .addSubcommand((subcommand) =>
      subcommand
        .setName("channels")
        .setDescription("List channels.")
        .addStringOption((option) => option.setName("query").setDescription("Optional filter.").setMaxLength(100).setRequired(false))
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("roles")
        .setDescription("List roles.")
        .addStringOption((option) => option.setName("query").setDescription("Optional filter.").setMaxLength(100).setRequired(false))
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("members")
        .setDescription("Search members.")
        .addStringOption((option) => option.setName("query").setDescription("Username, display name or user ID.").setMaxLength(100).setRequired(true))
    ),
  new SlashCommandBuilder()
    .setName("member-role")
    .setDescription("Add, remove or inspect member roles through VBOS.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addSubcommand((subcommand) =>
      subcommand
        .setName("add")
        .setDescription("Add a role to a member.")
        .addUserOption((option) => option.setName("user").setDescription("Target member.").setRequired(true))
        .addRoleOption((option) => option.setName("role").setDescription("Role to add.").setRequired(true))
        .addStringOption((option) => option.setName("reason").setDescription("Audit reason.").setMaxLength(200).setRequired(false))
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("remove")
        .setDescription("Remove a role from a member.")
        .addUserOption((option) => option.setName("user").setDescription("Target member.").setRequired(true))
        .addRoleOption((option) => option.setName("role").setDescription("Role to remove.").setRequired(true))
        .addStringOption((option) => option.setName("reason").setDescription("Audit reason.").setMaxLength(200).setRequired(false))
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("list")
        .setDescription("List member roles.")
        .addUserOption((option) => option.setName("user").setDescription("Target member.").setRequired(true))
    ),
  new SlashCommandBuilder()
    .setName("channel-control")
    .setDescription("Create, delete, lock, unlock and edit channels from VBOS.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addSubcommand((subcommand) =>
      subcommand
        .setName("create")
        .setDescription("Create a text, voice or category channel.")
        .addStringOption((option) =>
          option
            .setName("type")
            .setDescription("Channel type.")
            .addChoices({ name: "Text", value: "text" }, { name: "Voice", value: "voice" }, { name: "Category", value: "category" })
            .setRequired(true)
        )
        .addStringOption((option) => option.setName("name").setDescription("Channel/category name.").setMinLength(2).setMaxLength(100).setRequired(true))
        .addChannelOption((option) => option.setName("category").setDescription("Optional parent category.").addChannelTypes(ChannelType.GuildCategory).setRequired(false))
        .addStringOption((option) => option.setName("reason").setDescription("Audit reason.").setMaxLength(200).setRequired(false))
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("delete")
        .setDescription("Delete a channel or category. Requires confirm:true.")
        .addChannelOption((option) => option.setName("channel").setDescription("Channel/category to delete.").setRequired(true))
        .addBooleanOption((option) => option.setName("confirm").setDescription("Must be true.").setRequired(true))
        .addStringOption((option) => option.setName("reason").setDescription("Audit reason.").setMaxLength(200).setRequired(false))
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("topic")
        .setDescription("Update a text channel topic.")
        .addChannelOption((option) => option.setName("channel").setDescription("Text channel.").addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true))
        .addStringOption((option) => option.setName("topic").setDescription("New topic.").setMaxLength(1024).setRequired(true))
        .addStringOption((option) => option.setName("reason").setDescription("Audit reason.").setMaxLength(200).setRequired(false))
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("lock")
        .setDescription("Deny @everyone Send Messages in a channel.")
        .addChannelOption((option) => option.setName("channel").setDescription("Channel to lock.").setRequired(true))
        .addStringOption((option) => option.setName("reason").setDescription("Audit reason.").setMaxLength(200).setRequired(false))
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("unlock")
        .setDescription("Allow @everyone Send Messages in a channel.")
        .addChannelOption((option) => option.setName("channel").setDescription("Channel to unlock.").setRequired(true))
        .addStringOption((option) => option.setName("reason").setDescription("Audit reason.").setMaxLength(200).setRequired(false))
    )
].map((command) => command.toJSON());

function buildStandaloneMusicCommands() {
  return [
    new SlashCommandBuilder()
      .setName("play")
      .setDescription("Play a URL or search query through Lavalink.")
      .addStringOption((option) =>
        option
          .setName("query")
          .setDescription("Track URL or search text.")
          .setMaxLength(300)
          .setRequired(true)
      ),
    new SlashCommandBuilder()
      .setName("pause")
      .setDescription("Pause music playback."),
    new SlashCommandBuilder()
      .setName("resume")
      .setDescription("Resume music playback."),
    new SlashCommandBuilder()
      .setName("skip")
      .setDescription("Skip the current track."),
    new SlashCommandBuilder()
      .setName("stop")
      .setDescription("Stop playback and clear the queue."),
    new SlashCommandBuilder()
      .setName("queue")
      .setDescription("Show the current music queue."),
    new SlashCommandBuilder()
      .setName("nowplaying")
      .setDescription("Show the current track."),
    new SlashCommandBuilder()
      .setName("volume")
      .setDescription("Set playback volume.")
      .addIntegerOption((option) =>
        option
          .setName("percent")
          .setDescription("Volume from 1 to 150.")
          .setMinValue(1)
          .setMaxValue(150)
          .setRequired(true)
      ),
    new SlashCommandBuilder()
      .setName("loop")
      .setDescription("Set or cycle music loop mode.")
      .addStringOption((option) => addLoopModeChoices(option, false)),
    new SlashCommandBuilder()
      .setName("shuffle")
      .setDescription("Shuffle the queued tracks."),
    new SlashCommandBuilder()
      .setName("filter")
      .setDescription("Apply native Lavalink audio filters.")
      .addSubcommand((subcommand) =>
        subcommand
          .setName("preset")
          .setDescription("Apply an audio filter preset.")
          .addStringOption((option) => addAudioFilterPresetChoices(option, true))
      )
      .addSubcommand((subcommand) =>
        subcommand.setName("clear").setDescription("Clear the active audio filter.")
      )
      .addSubcommand((subcommand) =>
        subcommand.setName("status").setDescription("Show the active audio filter.")
      )
  ];
}


function addVbosCategoryChoices(option, required) {
  return option
    .setName("category")
    .setDescription("Optional command category.")
    .addChoices(
      { name: "Core / Control", value: "core" },
      { name: "Operations", value: "ops" },
      { name: "Custom Builder", value: "custom" },
      { name: "Automation", value: "automation" },
      { name: "Modules", value: "modules" },
      { name: "Moderation", value: "moderation" },
      { name: "Community", value: "community" },
      { name: "Music", value: "music" },
      { name: "Vireon Optional", value: "vireon" }
    )
    .setRequired(required);
}

function addLoopModeChoices(option, required) {
  return option
    .setName("mode")
    .setDescription("Loop mode. Leave empty to cycle.")
    .addChoices(
      { name: "Off", value: "off" },
      { name: "Track", value: "track" },
      { name: "Queue", value: "queue" }
    )
    .setRequired(required);
}

function addAudioFilterPresetChoices(option, required) {
  return option
    .setName("preset")
    .setDescription("Audio filter preset.")
    .addChoices(
      { name: "Off", value: "off" },
      { name: "Bassboost", value: "bassboost" },
      { name: "Nightcore", value: "nightcore" },
      { name: "Vaporwave", value: "vaporwave" },
      { name: "Karaoke", value: "karaoke" },
      { name: "8D", value: "eightd" },
      { name: "Low Pass", value: "lowpass" }
    )
    .setRequired(required);
}

function addPlaylistNameOption(option) {
  return option
    .setName("name")
    .setDescription("Playlist name.")
    .setMinLength(2)
    .setMaxLength(40)
    .setRequired(true);
}

function addPlaylistScopeChoices(option, required) {
  return option
    .setName("scope")
    .setDescription("User playlist or shared server playlist.")
    .addChoices(
      { name: "User", value: "user" },
      { name: "Server", value: "server" }
    )
    .setRequired(required);
}

const rest = new REST({ version: "10" }).setToken(token);

await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
logger.info({ commandCount: commands.length, guildId }, "Registered guild commands.");
