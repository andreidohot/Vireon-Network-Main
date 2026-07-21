import { EmbedBuilder } from "discord.js";

const DEFAULT_COLOR = 0xd4af37;

export function createVireonEmbed({
  title,
  description,
  color = DEFAULT_COLOR,
  footer = "Vireon Network",
  fields = []
}) {
  const embed = new EmbedBuilder()
    .setColor(normalizeColor(color))
    .setFooter({ text: footer })
    .setTimestamp(new Date());

  if (title) embed.setTitle(title);
  if (description) embed.setDescription(description);
  if (fields.length > 0) embed.addFields(fields);

  return embed;
}

export function normalizeColor(color) {
  if (typeof color === "number") return color;

  if (typeof color === "string") {
    const sanitized = color.replace("#", "").trim();
    const parsed = Number.parseInt(sanitized, 16);
    if (Number.isFinite(parsed)) return parsed;
  }

  return DEFAULT_COLOR;
}
