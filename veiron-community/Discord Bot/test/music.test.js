import { describe, expect, it } from "vitest";
import {
  advanceQueueState,
  buildAudioFilterPreset,
  buildLavalinkNodes,
  buildNowPlayingComponents,
  normalizeAudioFilterName,
  resolveLoopMode,
  resolveMusicButtonAction,
  resolveMusicCommand,
  shuffleTracks
} from "../src/music.js";

describe("music Lavalink infrastructure", () => {
  it("builds a single Lavalink node from host environment settings", () => {
    expect(buildLavalinkNodes({
      LAVALINK_HOST: "lavalink",
      LAVALINK_PORT: "2444",
      LAVALINK_PASSWORD: "secret",
      LAVALINK_SECURE: "false"
    })).toEqual([
      {
        name: "vireon-main",
        url: "http://lavalink:2444",
        auth: "secret",
        secure: false
      }
    ]);
  });

  it("builds multiple Lavalink nodes from JSON settings", () => {
    const nodes = buildLavalinkNodes({
      LAVALINK_NODES: JSON.stringify([
        { name: "primary", url: "http://lavalink-a:2333", auth: "a" },
        { url: "https://lavalink-b:443", auth: "b", secure: true, group: "eu" }
      ])
    });

    expect(nodes).toEqual([
      {
        name: "primary",
        url: "http://lavalink-a:2333",
        auth: "a",
        secure: false,
        group: undefined
      },
      {
        name: "vireon-2",
        url: "https://lavalink-b:443",
        auth: "b",
        secure: true,
        group: "eu"
      }
    ]);
  });

  it("rejects malformed multi-node settings", () => {
    expect(() => buildLavalinkNodes({ LAVALINK_NODES: "{}" })).toThrow("must be a JSON array");
    expect(() => buildLavalinkNodes({ LAVALINK_NODES: "[]" })).toThrow("at least one node");
    expect(() => buildLavalinkNodes({
      LAVALINK_NODES: JSON.stringify([{ url: "http://lavalink:2333" }])
    })).toThrow("missing auth");
  });
});

describe("music command routing", () => {
  it("keeps legacy /music subcommands and standalone commands compatible", () => {
    expect(resolveMusicCommand({
      isChatInputCommand: () => true,
      commandName: "music",
      options: { getSubcommand: () => "play" }
    })).toBe("play");
    expect(resolveMusicCommand({
      isChatInputCommand: () => true,
      commandName: "pause",
      options: {}
    })).toBe("pause");
    expect(resolveMusicCommand({
      isChatInputCommand: () => true,
      commandName: "filter",
      options: { getSubcommand: () => "preset" }
    })).toBe("filter");
    expect(resolveMusicCommand({
      isChatInputCommand: () => true,
      commandName: "setup-vireon",
      options: {}
    })).toBeNull();
  });
});

describe("music now-playing panel", () => {
  it("resolves supported now-playing button actions", () => {
    expect(resolveMusicButtonAction({
      isButton: () => true,
      customId: "vireon_music:pause"
    })).toBe("pause");
    expect(resolveMusicButtonAction({
      isButton: () => true,
      customId: "vireon_music:queue"
    })).toBe("queue");
    expect(resolveMusicButtonAction({
      isButton: () => true,
      customId: "vireon_music:unknown"
    })).toBeNull();
    expect(resolveMusicButtonAction({
      isButton: () => false,
      customId: "vireon_music:pause"
    })).toBeNull();
  });

  it("builds pause, skip and queue Discord buttons", () => {
    const row = buildNowPlayingComponents({ paused: false })[0].toJSON();
    expect(row.components.map((component) => component.custom_id)).toEqual([
      "vireon_music:pause",
      "vireon_music:skip",
      "vireon_music:queue"
    ]);
    expect(row.components.map((component) => component.label)).toEqual(["Pause", "Skip", "Queue"]);
    expect(buildNowPlayingComponents({ paused: true })[0].toJSON().components[0].label).toBe("Resume");
  });
});

describe("music audio filters", () => {
  it("normalizes audio filter preset names", () => {
    expect(normalizeAudioFilterName("Bass Boost!!")).toBe("bassboost");
    expect(normalizeAudioFilterName("8D")).toBe("8d");
  });

  it("builds native Lavalink filter presets", () => {
    expect(buildAudioFilterPreset("bassboost").filters.equalizer[0]).toEqual({ band: 0, gain: 0.22 });
    expect(buildAudioFilterPreset("nightcore").filters.timescale.pitch).toBeGreaterThan(1);
    expect(buildAudioFilterPreset("off").filters).toBeNull();
  });

  it("rejects unknown audio filter presets", () => {
    expect(() => buildAudioFilterPreset("mega-bass")).toThrow("Unknown audio filter");
  });
});

describe("music queue controls", () => {
  const a = { encoded: "a", info: { title: "A" } };
  const b = { encoded: "b", info: { title: "B" } };
  const c = { encoded: "c", info: { title: "C" } };

  it("cycles loop mode when no explicit mode is provided", () => {
    expect(resolveLoopMode("off")).toBe("track");
    expect(resolveLoopMode("track")).toBe("queue");
    expect(resolveLoopMode("queue")).toBe("off");
    expect(resolveLoopMode("off", "queue")).toBe("queue");
  });

  it("replays the current track in track loop mode", () => {
    const state = { current: a, queue: [b], loopMode: "track" };
    expect(advanceQueueState(state)).toBe(a);
    expect(state.queue).toEqual([b]);
    expect(state.current).toBe(a);
  });

  it("rotates the current track to the back in queue loop mode", () => {
    const state = { current: a, queue: [b, c], loopMode: "queue" };
    expect(advanceQueueState(state)).toBe(b);
    expect(state.queue).toEqual([c, a]);
    expect(state.current).toBe(b);
  });

  it("bypasses track loop when skipping", () => {
    const state = { current: a, queue: [b], loopMode: "track" };
    expect(advanceQueueState(state, { skipCurrent: true })).toBe(b);
    expect(state.current).toBe(b);
  });

  it("shuffles without mutating the original queue", () => {
    const queue = [a, b, c];
    expect(shuffleTracks(queue, () => 0).map((track) => track.encoded)).toEqual(["b", "c", "a"]);
    expect(queue.map((track) => track.encoded)).toEqual(["a", "b", "c"]);
  });
});
