import { createCanvas, loadImage } from "@napi-rs/canvas";

const WIDTH = 960;
const HEIGHT = 320;
const COLORS = {
  charcoal: "#08090d",
  panel: "#10131a",
  panelSoft: "#171b24",
  blood: "#7a1016",
  bloodBright: "#b01822",
  gold: "#d4af37",
  mineralGold: "#b8942f",
  text: "#f2f4f8",
  muted: "#9aa3b2"
};

export async function renderRankCard({ user, profile, rank, progress }) {
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

function drawBackground(ctx) {
  const gradient = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  gradient.addColorStop(0, COLORS.charcoal);
  gradient.addColorStop(0.56, COLORS.panel);
  gradient.addColorStop(1, "#050608");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  ctx.fillStyle = COLORS.blood;
  ctx.globalAlpha = 0.82;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(320, 0);
  ctx.lineTo(250, HEIGHT);
  ctx.lineTo(0, HEIGHT);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.strokeStyle = COLORS.gold;
  ctx.lineWidth = 2;
  ctx.strokeRect(18, 18, WIDTH - 36, HEIGHT - 36);

  ctx.fillStyle = COLORS.panelSoft;
  roundRect(ctx, 280, 44, 632, 232, 18);
  ctx.fill();
}

async function drawAvatar(ctx, user) {
  const x = 72;
  const y = 70;
  const size = 168;

  ctx.save();
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
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
    gradient.addColorStop(1, COLORS.mineralGold);
    ctx.fillStyle = gradient;
    ctx.fillRect(x, y, size, size);
    ctx.fillStyle = COLORS.text;
    ctx.font = "700 64px Georgia, serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(getInitials(user.displayName), x + size / 2, y + size / 2 + 2);
  }

  ctx.restore();
  ctx.strokeStyle = COLORS.gold;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size / 2 + 3, 0, Math.PI * 2);
  ctx.stroke();
}

function drawIdentity(ctx, user, rank) {
  ctx.fillStyle = COLORS.gold;
  ctx.font = "700 34px Georgia, serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("Vireon Rank Card", 310, 88);

  ctx.fillStyle = COLORS.text;
  ctx.font = "700 42px Georgia, serif";
  ctx.fillText(truncateText(ctx, user.displayName, 410), 310, 142);

  ctx.fillStyle = COLORS.muted;
  ctx.font = "500 20px Arial, sans-serif";
  ctx.fillText(user.tag ?? user.id, 312, 176);

  ctx.fillStyle = COLORS.bloodBright;
  roundRect(ctx, 740, 70, 132, 58, 14);
  ctx.fill();
  ctx.fillStyle = COLORS.text;
  ctx.font = "800 28px Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(`#${rank}`, 806, 108);
}

function drawStats(ctx, profile, progress) {
  const stats = [
    ["LEVEL", String(profile.level ?? progress.level)],
    ["XP", Number(profile.xp ?? 0).toLocaleString()],
    ["NEXT", progress.nextLevelXp === null ? "MAX" : progress.xpNeededForNextLevel.toLocaleString()]
  ];

  stats.forEach(([label, value], index) => {
    const x = 310 + index * 185;
    ctx.fillStyle = COLORS.charcoal;
    roundRect(ctx, x, 198, 150, 54, 12);
    ctx.fill();
    ctx.fillStyle = COLORS.muted;
    ctx.font = "700 12px Arial, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(label, x + 14, 218);
    ctx.fillStyle = COLORS.gold;
    ctx.font = "800 22px Arial, sans-serif";
    ctx.fillText(value, x + 14, 244);
  });
}

function drawProgress(ctx, progress) {
  const x = 310;
  const y = 270;
  const width = 562;
  const height = 16;
  const filled = Math.round(width * (progress.percentToNextLevel / 100));

  ctx.fillStyle = COLORS.charcoal;
  roundRect(ctx, x, y, width, height, 8);
  ctx.fill();
  const gradient = ctx.createLinearGradient(x, y, x + width, y);
  gradient.addColorStop(0, COLORS.bloodBright);
  gradient.addColorStop(1, COLORS.gold);
  ctx.fillStyle = gradient;
  roundRect(ctx, x, y, filled, height, 8);
  ctx.fill();

  ctx.fillStyle = COLORS.muted;
  ctx.font = "600 13px Arial, sans-serif";
  ctx.textAlign = "right";
  ctx.fillText(`${progress.percentToNextLevel}% to next level`, x + width, y - 8);
}

function drawFooter(ctx) {
  ctx.fillStyle = COLORS.gold;
  ctx.font = "700 18px Georgia, serif";
  ctx.textAlign = "left";
  ctx.fillText("VIREON NETWORK", 72, 274);
  ctx.fillStyle = COLORS.muted;
  ctx.font = "500 13px Arial, sans-serif";
  ctx.fillText("Blood Red / Charcoal / Mineral Gold", 72, 296);
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
