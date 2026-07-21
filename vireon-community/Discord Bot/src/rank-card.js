import { GlobalFonts, createCanvas, loadImage } from "@napi-rs/canvas";

const WIDTH = 1100;
const HEIGHT = 360;
const AVATAR_SIZE = 154;
const FONT_FAMILY = "VBOS Sans";
const FONT_FALLBACK = `"${FONT_FAMILY}", "DejaVu Sans", "Noto Sans", "Liberation Sans", sans-serif`;
const FONT_PATHS = [
  ["/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", FONT_FAMILY],
  ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", FONT_FAMILY],
  ["/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf", FONT_FAMILY],
  ["/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf", FONT_FAMILY],
  ["/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf", FONT_FAMILY],
  ["/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf", FONT_FAMILY]
];
const COLORS = {
  bg0: "#070a12",
  bg1: "#0d1220",
  panel: "rgba(18, 24, 38, 0.92)",
  panelSoft: "#171f30",
  gold: "#f3c95b",
  goldSoft: "#b8942f",
  aqua: "#18d8ff",
  blood: "#981824",
  bloodBright: "#d11e31",
  text: "#f7f9ff",
  muted: "#aab4c7",
  mutedDark: "#6f7b91",
  line: "#2a3348"
};

let fontsReady = false;

export async function renderRankCard({ user, profile, rank, progress }) {
  ensureRankCardFonts();

  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d");

  drawBackground(ctx);
  await drawAvatar(ctx, user);
  drawIdentity(ctx, user, rank);
  drawStats(ctx, profile, progress);
  drawProgress(ctx, progress);
  drawFooter(ctx);

  return canvas.toBuffer("image/png");
}

export function ensureRankCardFonts() {
  if (fontsReady) return;
  fontsReady = true;

  try {
    GlobalFonts.loadSystemFonts();
  } catch {
    // Rendering continues with canvas fallback fonts.
  }

  for (const [fontPath, family] of FONT_PATHS) {
    try {
      GlobalFonts.registerFromPath(fontPath, family);
    } catch {
      // Optional font path, depends on host/container image.
    }
  }
}

function drawBackground(ctx) {
  const gradient = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  gradient.addColorStop(0, COLORS.bg0);
  gradient.addColorStop(0.55, COLORS.bg1);
  gradient.addColorStop(1, "#04050a");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const red = ctx.createLinearGradient(0, 0, 360, HEIGHT);
  red.addColorStop(0, COLORS.blood);
  red.addColorStop(1, "#5a0b13");
  ctx.fillStyle = red;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(355, 0);
  ctx.lineTo(292, HEIGHT);
  ctx.lineTo(0, HEIGHT);
  ctx.closePath();
  ctx.fill();

  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = COLORS.aqua;
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 8; i += 1) {
    ctx.beginPath();
    ctx.arc(150, 180, 80 + i * 23, Math.PI * 1.18, Math.PI * 1.82);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  const border = ctx.createLinearGradient(24, 24, WIDTH - 24, HEIGHT - 24);
  border.addColorStop(0, COLORS.gold);
  border.addColorStop(0.5, COLORS.aqua);
  border.addColorStop(1, COLORS.gold);
  ctx.strokeStyle = border;
  ctx.lineWidth = 2;
  roundRect(ctx, 24, 24, WIDTH - 48, HEIGHT - 48, 18);
  ctx.stroke();

  ctx.fillStyle = COLORS.panel;
  roundRect(ctx, 330, 48, 720, 250, 24);
  ctx.fill();

  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 1;
  roundRect(ctx, 330, 48, 720, 250, 24);
  ctx.stroke();
}

async function drawAvatar(ctx, user) {
  const x = 78;
  const y = 70;
  const size = AVATAR_SIZE;
  const center = x + size / 2;

  ctx.save();
  ctx.beginPath();
  ctx.arc(center, y + size / 2, size / 2, 0, Math.PI * 2);
  ctx.clip();

  let drewAvatar = false;
  if (user.avatarUrl) {
    try {
      const avatar = await loadImage(user.avatarUrl);
      ctx.drawImage(avatar, x, y, size, size);
      drewAvatar = true;
    } catch {
      drewAvatar = false;
    }
  }

  if (!drewAvatar) {
    const gradient = ctx.createLinearGradient(x, y, x + size, y + size);
    gradient.addColorStop(0, COLORS.bloodBright);
    gradient.addColorStop(0.5, COLORS.aqua);
    gradient.addColorStop(1, COLORS.goldSoft);
    ctx.fillStyle = gradient;
    ctx.fillRect(x, y, size, size);
    ctx.fillStyle = COLORS.text;
    ctx.font = rankFont(700, 58);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(getInitials(user.displayName), center, y + size / 2 + 2);
  }

  ctx.restore();

  ctx.strokeStyle = COLORS.gold;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(center, y + size / 2, size / 2 + 4, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = COLORS.aqua;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(center, y + size / 2, size / 2 + 12, Math.PI * 0.12, Math.PI * 1.68);
  ctx.stroke();
}

function drawIdentity(ctx, user, rank) {
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  ctx.fillStyle = COLORS.aqua;
  ctx.font = rankFont(800, 15);
  ctx.letterSpacing = "2px";
  ctx.fillText("VIREON XP ENGINE", 365, 88);
  ctx.letterSpacing = "0px";

  ctx.fillStyle = COLORS.text;
  ctx.font = rankFont(800, 44);
  ctx.fillText(truncateText(ctx, user.displayName, 470), 365, 145);

  ctx.fillStyle = COLORS.muted;
  ctx.font = rankFont(500, 20);
  ctx.fillText(truncateText(ctx, user.tag ?? user.id, 430), 367, 180);

  const rankLabel = `#${Number(rank || 0).toLocaleString()}`;
  const badgeWidth = Math.max(138, ctx.measureText(rankLabel).width + 54);
  const badgeX = 880 - badgeWidth / 2;
  const badgeGradient = ctx.createLinearGradient(badgeX, 70, badgeX + badgeWidth, 132);
  badgeGradient.addColorStop(0, COLORS.bloodBright);
  badgeGradient.addColorStop(1, "#b71425");
  ctx.fillStyle = badgeGradient;
  roundRect(ctx, badgeX, 70, badgeWidth, 62, 16);
  ctx.fill();

  ctx.fillStyle = COLORS.text;
  ctx.font = rankFont(900, 30);
  ctx.textAlign = "center";
  ctx.fillText(rankLabel, badgeX + badgeWidth / 2, 110);

  ctx.fillStyle = COLORS.muted;
  ctx.font = rankFont(700, 12);
  ctx.fillText("SERVER RANK", badgeX + badgeWidth / 2, 152);
}

function drawStats(ctx, profile, progress) {
  const stats = [
    ["LEVEL", String(profile.level ?? progress.level ?? 0)],
    ["TOTAL XP", Number(profile.xp ?? 0).toLocaleString()],
    ["NEXT", progress.nextLevelXp === null ? "MAX" : Number(progress.xpNeededForNextLevel ?? 0).toLocaleString()]
  ];

  stats.forEach(([label, value], index) => {
    const x = 365 + index * 205;
    ctx.fillStyle = "rgba(5, 7, 12, 0.82)";
    roundRect(ctx, x, 204, 172, 64, 14);
    ctx.fill();
    ctx.strokeStyle = COLORS.line;
    ctx.lineWidth = 1;
    roundRect(ctx, x, 204, 172, 64, 14);
    ctx.stroke();

    ctx.fillStyle = COLORS.muted;
    ctx.font = rankFont(800, 12);
    ctx.textAlign = "left";
    ctx.fillText(label, x + 16, 228);

    ctx.fillStyle = COLORS.gold;
    ctx.font = rankFont(900, 25);
    ctx.fillText(truncateText(ctx, value, 136), x + 16, 256);
  });
}

function drawProgress(ctx, progress) {
  const x = 365;
  const y = 292;
  const width = 642;
  const height = 18;
  const percent = clamp(Number(progress.percentToNextLevel ?? 0), 0, 100);
  const filled = Math.round(width * (percent / 100));

  ctx.fillStyle = "rgba(5, 7, 12, 0.92)";
  roundRect(ctx, x, y, width, height, 9);
  ctx.fill();

  if (filled > 0) {
    const gradient = ctx.createLinearGradient(x, y, x + width, y);
    gradient.addColorStop(0, COLORS.bloodBright);
    gradient.addColorStop(0.58, COLORS.gold);
    gradient.addColorStop(1, COLORS.aqua);
    ctx.fillStyle = gradient;
    roundRect(ctx, x, y, filled, height, 9);
    ctx.fill();
  }

  ctx.fillStyle = COLORS.muted;
  ctx.font = rankFont(700, 14);
  ctx.textAlign = "right";
  ctx.fillText(`${percent}% to next level`, x + width, y - 10);
}

function drawFooter(ctx) {
  ctx.textAlign = "left";
  ctx.fillStyle = COLORS.text;
  ctx.font = rankFont(900, 19);
  ctx.fillText("VIREON NETWORK", 78, 268);
  ctx.fillStyle = COLORS.muted;
  ctx.font = rankFont(500, 13);
  ctx.fillText("Rank • XP • Shards • Community", 78, 292);
}

function rankFont(weight, size) {
  return `${weight} ${size}px ${FONT_FALLBACK}`;
}

function getInitials(value = "V") {
  return String(value)
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "V";
}

function truncateText(ctx, value, maxWidth) {
  const text = String(value ?? "Vireon Member");
  if (ctx.measureText(text).width <= maxWidth) return text;

  let next = text;
  while (next.length > 1 && ctx.measureText(`${next}...`).width > maxWidth) {
    next = next.slice(0, -1);
  }
  return `${next}...`;
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function roundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}
