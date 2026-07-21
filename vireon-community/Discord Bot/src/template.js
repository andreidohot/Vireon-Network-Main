import { ChannelType, PermissionFlagsBits } from "discord.js";

export const ROLE_NAMES = {
  founder: "Founder",
  coreTeam: "Core Team",
  admin: "Admin",
  moderator: "Moderator",
  security: "Security Reviewer",
  developer: "Developer",
  miner: "Miner",
  nodeOperator: "Node Operator",
  builder: "Builder",
  partner: "Partner",
  earlySupporter: "Early Supporter",
  member: "Vireon Member",
  muted: "Muted",
  bot: "Bot"
};

export const ROLE_TEMPLATE = [
  {
    key: "founder",
    name: ROLE_NAMES.founder,
    color: 0xd4af37,
    hoist: true,
    permissions: ["Administrator"],
    reason: "Project owner and final decision authority before decentralized governance exists."
  },
  {
    key: "coreTeam",
    name: ROLE_NAMES.coreTeam,
    color: 0x2f80ed,
    hoist: true,
    permissions: ["ManageChannels", "ManageRoles", "ManageMessages", "ViewAuditLog"],
    reason: "Core protocol, product and operations team."
  },
  {
    key: "admin",
    name: ROLE_NAMES.admin,
    color: 0xeb5757,
    hoist: true,
    permissions: ["ManageGuild", "ManageChannels", "ManageRoles", "ManageMessages", "KickMembers", "BanMembers", "ViewAuditLog"],
    reason: "Server administration."
  },
  {
    key: "moderator",
    name: ROLE_NAMES.moderator,
    color: 0xf2994a,
    hoist: true,
    permissions: ["ManageMessages", "ModerateMembers", "KickMembers"],
    reason: "Community moderation."
  },
  {
    key: "security",
    name: ROLE_NAMES.security,
    color: 0x9b51e0,
    hoist: true,
    permissions: [],
    reason: "Security review, disclosure triage and audit discussions."
  },
  {
    key: "developer",
    name: ROLE_NAMES.developer,
    color: 0x56ccf2,
    hoist: false,
    permissions: [],
    reason: "Builders working on apps, SDKs, contracts and infrastructure."
  },
  {
    key: "miner",
    name: ROLE_NAMES.miner,
    color: 0xf2c94c,
    hoist: false,
    permissions: [],
    reason: "Mining community."
  },
  {
    key: "nodeOperator",
    name: ROLE_NAMES.nodeOperator,
    color: 0x27ae60,
    hoist: false,
    permissions: [],
    reason: "Node operators and infrastructure contributors."
  },
  {
    key: "builder",
    name: ROLE_NAMES.builder,
    color: 0x00b894,
    hoist: false,
    permissions: [],
    reason: "dApp, game and product builders."
  },
  {
    key: "partner",
    name: ROLE_NAMES.partner,
    color: 0xbb6bd9,
    hoist: false,
    permissions: [],
    reason: "Ecosystem partners."
  },
  {
    key: "earlySupporter",
    name: ROLE_NAMES.earlySupporter,
    color: 0xbdbdbd,
    hoist: false,
    permissions: [],
    reason: "Early community supporters."
  },
  {
    key: "member",
    name: ROLE_NAMES.member,
    color: 0x828282,
    hoist: false,
    permissions: [],
    reason: "Verified community member."
  },
  {
    key: "muted",
    name: ROLE_NAMES.muted,
    color: 0x4f4f4f,
    hoist: false,
    permissions: [],
    reason: "Restricted member role."
  },
  {
    key: "bot",
    name: ROLE_NAMES.bot,
    color: 0x2d9cdb,
    hoist: false,
    permissions: [],
    reason: "Automation accounts."
  }
];

export const CHANNEL_TEMPLATE = [
  {
    name: "START HERE",
    type: ChannelType.GuildCategory,
    visibility: "public_read",
    children: [
      { name: "welcome", topic: "Start here. What Vireon Network is, what is planned, and what is not live yet.", readOnly: true },
      { name: "rules", topic: "Community rules, safety rules and anti-scam warnings.", readOnly: true },
      { name: "announcements", topic: "Official Vireon updates only.", readOnly: true },
      { name: "roadmap", topic: "Draft roadmap, phases and public progress notes.", readOnly: true },
      { name: "faq", topic: "Short answers about VIRE, mining, wallet, explorer, testnet and mainnet status.", readOnly: true },
      { name: "roles", topic: "Role request and onboarding area.", readOnly: false }
    ]
  },
  {
    name: "COMMUNITY",
    type: ChannelType.GuildCategory,
    visibility: "members",
    children: [
      { name: "general", topic: "General Vireon discussion." },
      { name: "romana", topic: "Romanian community chat." },
      { name: "english", topic: "English community chat." },
      { name: "ideas", topic: "Community ideas. Ideas are not roadmap commitments." },
      { name: "showcase", topic: "Show what you are building around Vireon." },
      { name: "off-topic", topic: "Relaxed community discussion." }
    ]
  },
  {
    name: "VIREON DEVELOPMENT",
    type: ChannelType.GuildCategory,
    visibility: "members",
    children: [
      { name: "dev-chat", topic: "Development discussion across Vireon packages." },
      { name: "protocol-design", topic: "Protocol design discussions. Draft until implemented and tested." },
      { name: "rust-core", topic: "Rust core, node, consensus, blocks, transactions and mining rules." },
      { name: "smart-contracts", topic: "Rust/WASM contract model, standards and experiments." },
      { name: "wallet-explorer", topic: "Wallet, explorer, indexer and RPC gateway." },
      { name: "docs-research", topic: "Specs, whitepaper, research notes and open protocol decisions." },
      { name: "bugs", topic: "Bug reports for prototypes, docs and public test builds." }
    ]
  },
  {
    name: "MINING AND NODES",
    type: ChannelType.GuildCategory,
    visibility: "members",
    children: [
      { name: "mining", topic: "Mining discussion. No guaranteed profit or investment claims." },
      { name: "node-operators", topic: "Node setup, logs, uptime and operations." },
      { name: "testnet-faucet", topic: "Public testnet faucet requests once available." },
      { name: "mining-pools", topic: "Mining pool research, operators and payout logic." }
    ]
  },
  {
    name: "ECOSYSTEM",
    type: ChannelType.GuildCategory,
    visibility: "members",
    children: [
      { name: "dapps-games", topic: "dApps, games and app development ideas." },
      { name: "nfts-assets", topic: "NFTs, native assets, game items and creator products." },
      { name: "passport-identity", topic: "Passport proof layer, identity proofs and reputation design." },
      { name: "marketplace", topic: "Marketplace, licenses and digital product settlement." },
      { name: "encrypted-communication", topic: "Encrypted communication permissions and off-chain payload ideas." }
    ]
  },
  {
    name: "GOVERNANCE",
    type: ChannelType.GuildCategory,
    visibility: "members",
    children: [
      { name: "proposals", topic: "Community proposals. Not binding unless accepted by the current governance process." },
      { name: "governance-discussion", topic: "DAO research, voting models and process discussion." },
      { name: "decision-log", topic: "Accepted decisions and public rationale.", readOnly: true }
    ]
  },
  {
    name: "SUPPORT AND SAFETY",
    type: ChannelType.GuildCategory,
    visibility: "members",
    children: [
      { name: "help", topic: "Community help and onboarding." },
      { name: "report-scam", topic: "Report scams, impersonation and suspicious links." },
      { name: "security-disclosure", topic: "Responsible disclosure coordination. Do not publish exploit details.", restrictedTo: ["founder", "coreTeam", "admin", "security"] }
    ]
  },
  {
    name: "ADMIN",
    type: ChannelType.GuildCategory,
    visibility: "staff",
    children: [
      { name: "admin-hq", topic: "Private staff coordination.", restrictedTo: ["founder", "coreTeam", "admin"] },
      { name: "mod-log", topic: "Moderation notes and bot logs.", restrictedTo: ["founder", "coreTeam", "admin", "moderator"] },
      { name: "staff-tasks", topic: "Internal staff tasks.", restrictedTo: ["founder", "coreTeam", "admin", "moderator"] },
      { name: "security-room", topic: "Private security triage.", restrictedTo: ["founder", "coreTeam", "admin", "security"] },
      { name: "incident-room", topic: "Incident response and emergency coordination.", restrictedTo: ["founder", "coreTeam", "admin", "security"] }
    ]
  },
  {
    name: "VOICE",
    type: ChannelType.GuildCategory,
    visibility: "members",
    children: [
      { name: "Community Lounge", type: ChannelType.GuildVoice },
      { name: "Dev Room", type: ChannelType.GuildVoice },
      { name: "Mining Room", type: ChannelType.GuildVoice },
      { name: "Staff Voice", type: ChannelType.GuildVoice, restrictedTo: ["founder", "coreTeam", "admin", "moderator"] }
    ]
  }
];



export const SETUP_TEMPLATE_PRESETS = [
  {
    id: "starter",
    name: "Starter",
    description: "Minimal safe community setup: start here, community, support, admin and voice.",
    categories: ["START HERE", "COMMUNITY", "SUPPORT AND SAFETY", "ADMIN", "VOICE"]
  },
  {
    id: "community",
    name: "Community",
    description: "Balanced public community setup with governance and support areas.",
    categories: ["START HERE", "COMMUNITY", "GOVERNANCE", "SUPPORT AND SAFETY", "ADMIN", "VOICE"]
  },
  {
    id: "developer",
    name: "Developer",
    description: "Community plus protocol/developer workspaces.",
    categories: ["START HERE", "COMMUNITY", "VIREON DEVELOPMENT", "GOVERNANCE", "SUPPORT AND SAFETY", "ADMIN", "VOICE"]
  },
  {
    id: "gaming",
    name: "Gaming",
    description: "Community server setup for games/apps with ecosystem, support, staff and voice.",
    categories: ["START HERE", "COMMUNITY", "ECOSYSTEM", "SUPPORT AND SAFETY", "ADMIN", "VOICE"]
  },
  {
    id: "ultimate",
    name: "Ultimate",
    description: "Full VBOS/Vireon structure with all standard categories.",
    categories: null
  }
];

export const RANK_ROLE_TEMPLATE = [
  1, 2, 3, 4, 5, 10, 15, 20, 25, 30,
  40, 50, 60, 75, 100, 125, 150, 175, 200,
  250, 300, 350, 400, 450, 500, 600, 700, 800, 900, 1000
].map((level) => ({
  key: `rankLevel${level}`,
  name: `Level ${level}`,
  color: level >= 500 ? 0xd4af37 : level >= 100 ? 0x14d4ff : 0x828282,
  hoist: false,
  permissions: [],
  reason: `Optional VBOS XP rank reward role for level ${level}.`,
  rankLevel: level
}));

export function normalizeSetupTemplateId(templateId) {
  const normalized = String(templateId ?? "ultimate").trim().toLowerCase();
  return SETUP_TEMPLATE_PRESETS.some((preset) => preset.id === normalized) ? normalized : "ultimate";
}

export function getSetupTemplatePreset(templateId = "ultimate") {
  const id = normalizeSetupTemplateId(templateId);
  return SETUP_TEMPLATE_PRESETS.find((preset) => preset.id === id) ?? SETUP_TEMPLATE_PRESETS.at(-1);
}

export function getSetupChannelTemplate(templateId = "ultimate") {
  const preset = getSetupTemplatePreset(templateId);
  if (!preset.categories) return CHANNEL_TEMPLATE;
  const allowed = new Set(preset.categories);
  return CHANNEL_TEMPLATE.filter((category) => allowed.has(category.name));
}

export function getSetupRoleTemplate({ includeRankRoles = false } = {}) {
  return includeRankRoles ? [...ROLE_TEMPLATE, ...RANK_ROLE_TEMPLATE] : ROLE_TEMPLATE;
}

export function getSetupSeedMessages(channelTemplates = CHANNEL_TEMPLATE) {
  const channelNames = new Set();
  for (const category of channelTemplates) {
    for (const child of category.children ?? []) channelNames.add(child.name);
  }

  return Object.fromEntries(
    Object.entries(SEED_MESSAGES).filter(([channelName]) => channelNames.has(channelName))
  );
}

export function describeSetupPlan({ templateId = "ultimate", includeRankRoles = false } = {}) {
  const preset = getSetupTemplatePreset(templateId);
  const channels = getSetupChannelTemplate(preset.id);
  const textChannels = channels.reduce((count, category) => count + (category.children ?? []).filter((child) => (child.type ?? ChannelType.GuildText) === ChannelType.GuildText).length, 0);
  const voiceChannels = channels.reduce((count, category) => count + (category.children ?? []).filter((child) => child.type === ChannelType.GuildVoice).length, 0);
  return {
    id: preset.id,
    name: preset.name,
    description: preset.description,
    categories: channels.length,
    textChannels,
    voiceChannels,
    roles: ROLE_TEMPLATE.length + (includeRankRoles ? RANK_ROLE_TEMPLATE.length : 0),
    rankRoles: includeRankRoles ? RANK_ROLE_TEMPLATE.length : 0
  };
}

export const SEED_MESSAGES = {
  welcome: [
    {
      title: "Welcome to Vireon Network",
      body: [
        "Vireon Network is a Rust-based mineable Layer 1 for digital ownership, low-fee applications, games, software licenses, NFTs, identity proofs, encrypted communication and storage-backed digital products.",
        "",
        "Current status: Draft / prototype planning. Features must not be presented as live until they exist, run, and are documented.",
        "",
        "Start with #rules, #roadmap and #faq."
      ].join("\n")
    }
  ],
  rules: [
    {
      title: "Community Rules",
      body: [
        "1. No scams, impersonation, phishing, fake airdrops or fake investment claims.",
        "2. No guaranteed returns, exchange promises, yield promises or financial advice.",
        "3. Keep protocol claims honest: Draft, Planned, Research, Prototype, Private devnet, Public testnet, Mainnet candidate.",
        "4. Do not share private keys, seed phrases, wallet files, tokens or production secrets.",
        "5. Security issues go to #security-disclosure, not public channels.",
        "6. Respect builders, miners and community members. Critique ideas, not people."
      ].join("\n")
    }
  ],
  roadmap: [
    {
      title: "Vireon Roadmap Snapshot",
      body: [
        "Phase 0: Specs and workspace.",
        "Phase 1: Core minimal.",
        "Phase 2: Devnet.",
        "Phase 3: RPC, wallet and explorer.",
        "Phase 4: Assets and contracts.",
        "Phase 5: Passport and product layer.",
        "Phase 6: Mining pool and public testnet.",
        "Phase 7: Security and mainnet candidate.",
        "",
        "A feature is real only when it has code, verification, documentation, status visibility and no false public claims."
      ].join("\n")
    }
  ],
  faq: [
    {
      title: "Quick FAQ",
      body: [
        "Ticker: VIRE.",
        "Max supply target: 60,000,000 VIRE.",
        "Block time target: 60 seconds.",
        "Initial direction: PoW first, with PoLW as research / upgrade path.",
        "Core direction: Rust-based.",
        "Large files and encrypted messages stay off-chain; the chain stores settlement, ownership, proofs, hashes, permissions and critical state."
      ].join("\n")
    }
  ],
  roles: [
    {
      title: "Choose Your Vireon Roles",
      body: [
        "Press Join Vireon to unlock the main community channels.",
        "",
        "Optional roles help route discussions and future announcements:",
        "Developer, Miner, Node Operator, Builder and Early Supporter.",
        "",
        "You can press optional role buttons again to remove those roles."
      ].join("\n")
    }
  ],
  "decision-log": [
    {
      title: "Decision Log",
      body: [
        "Use this channel only for accepted decisions and rationale.",
        "",
        "Open protocol decisions should remain in #protocol-design or #docs-research until finalized."
      ].join("\n")
    }
  ],
  "security-disclosure": [
    {
      title: "Security Disclosure",
      body: [
        "Report vulnerabilities privately here.",
        "",
        "Do not publish exploit details, private keys, production credentials, seed phrases or attack instructions in public channels."
      ].join("\n")
    }
  ],
  "admin-hq": [
    {
      title: "Admin HQ",
      body: [
        "Private coordination for Vireon staff.",
        "",
        "Before mainnet candidate, governance can remain founder/core-team led, but decisions should be logged clearly and not implied as DAO-controlled unless a real mechanism exists."
      ].join("\n")
    }
  ]
};

export const ROLE_BUTTONS = [
  { customId: "vireon_role:member", label: "Join Vireon", roleKey: "member", required: true },
  { customId: "vireon_role:developer", label: "Developer", roleKey: "developer" },
  { customId: "vireon_role:miner", label: "Miner", roleKey: "miner" },
  { customId: "vireon_role:nodeOperator", label: "Node Operator", roleKey: "nodeOperator" },
  { customId: "vireon_role:builder", label: "Builder", roleKey: "builder" },
  { customId: "vireon_role:earlySupporter", label: "Early Supporter", roleKey: "earlySupporter" }
];

export function permissionBits(names) {
  return names.reduce((bits, name) => bits | PermissionFlagsBits[name], 0n);
}
