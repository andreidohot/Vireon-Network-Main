import { afterEach, describe, expect, it } from "vitest";
import {
  deletePushSubscription,
  getPushConfig,
  savePushSubscription
} from "../src/push-notifications.js";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("push notifications", () => {
  it("reports disabled config when VAPID keys are missing", () => {
    delete process.env.WEB_PUSH_VAPID_PUBLIC_KEY;
    delete process.env.WEB_PUSH_VAPID_PRIVATE_KEY;

    expect(getPushConfig()).toMatchObject({
      enabled: false,
      publicKey: ""
    });
  });

  it("saves, disables and reactivates subscriptions", async () => {
    const store = createStoreMock();
    const user = { id: "user-1", email: "admin@vireon.local", role: "ADMIN" };
    const subscription = {
      endpoint: "https://push.example/subscription-1",
      keys: {
        p256dh: "public-key",
        auth: "auth-secret"
      }
    };

    const saved = await savePushSubscription(store, user, subscription);
    await deletePushSubscription(store, subscription.endpoint);
    const reactivated = await savePushSubscription(store, user, subscription);

    expect(saved).toMatchObject({
      userId: "user-1",
      endpoint: subscription.endpoint,
      disabled: false
    });
    expect(reactivated).toMatchObject({
      id: saved.id,
      disabled: false,
      disabledAt: null
    });
    expect(await store.list("push-subscriptions")).toHaveLength(1);
  });
});

function createStoreMock() {
  const collections = new Map();

  return {
    async list(collection) {
      return collections.get(collection) ?? [];
    },
    async add(collection, item) {
      const items = collections.get(collection) ?? [];
      collections.set(collection, [...items, item]);
      return item;
    },
    async update(collection, predicate, updater) {
      const items = collections.get(collection) ?? [];
      let updated = null;
      const nextItems = items.map((item) => {
        if (!predicate(item)) return item;
        updated = { ...item, ...updater(item) };
        return updated;
      });
      collections.set(collection, nextItems);
      return updated;
    }
  };
}
