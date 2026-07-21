import crypto from "node:crypto";
import webpush from "web-push";
import { childLogger, serializeError } from "./logger.js";

const COLLECTION = "push-subscriptions";
const logger = childLogger({ module: "push-notifications" });

export function getPushConfig() {
  const publicKey = process.env.WEB_PUSH_VAPID_PUBLIC_KEY ?? "";
  const privateKey = process.env.WEB_PUSH_VAPID_PRIVATE_KEY ?? "";
  const subject = process.env.WEB_PUSH_SUBJECT
    ?? (process.env.ADMIN_DEFAULT_EMAIL ? `mailto:${process.env.ADMIN_DEFAULT_EMAIL}` : "mailto:admin@vireon.local");

  return {
    enabled: Boolean(publicKey && privateKey),
    publicKey,
    subject
  };
}

export function configureWebPush() {
  const config = getPushConfig();
  if (!config.enabled) return config;

  webpush.setVapidDetails(config.subject, config.publicKey, process.env.WEB_PUSH_VAPID_PRIVATE_KEY);
  return config;
}

export async function savePushSubscription(store, user, subscription) {
  validateSubscription(subscription);
  const id = subscriptionId(subscription.endpoint);
  const now = new Date().toISOString();
  const item = {
    id,
    userId: user.id,
    userEmail: user.email,
    userRole: user.role,
    endpoint: subscription.endpoint,
    keys: subscription.keys,
    disabled: false,
    disabledAt: null,
    createdAt: now,
    updatedAt: now
  };

  const updated = await store.update(COLLECTION, (entry) => entry.id === id, () => item);
  return updated ?? store.add(COLLECTION, item);
}

export async function deletePushSubscription(store, endpoint) {
  if (!endpoint) return null;
  const id = subscriptionId(endpoint);
  return store.update(COLLECTION, (entry) => entry.id === id, () => ({
    disabled: true,
    disabledAt: new Date().toISOString()
  }));
}

export async function sendPushNotification(store, payload, { roles = [] } = {}) {
  const config = configureWebPush();
  if (!config.enabled) {
    return { ok: false, sent: 0, failed: 0, disabled: true };
  }

  const subscriptions = (await store.list(COLLECTION))
    .filter((entry) => !entry.disabled)
    .filter((entry) => roles.length === 0 || roles.includes(entry.userRole));

  let sent = 0;
  let failed = 0;

  await Promise.all(subscriptions.map(async (entry) => {
    try {
      await webpush.sendNotification({
        endpoint: entry.endpoint,
        keys: entry.keys
      }, JSON.stringify(payload));
      sent += 1;
    } catch (error) {
      failed += 1;
      logger.warn({ error: serializeError(error), subscriptionId: entry.id }, "Failed to send web push notification.");
      if (error.statusCode === 404 || error.statusCode === 410) {
        await deletePushSubscription(store, entry.endpoint);
      }
    }
  }));

  return { ok: failed === 0, sent, failed, disabled: false };
}

function validateSubscription(subscription) {
  if (!subscription?.endpoint || !subscription.keys?.p256dh || !subscription.keys?.auth) {
    throw new Error("Invalid web push subscription.");
  }
}

function subscriptionId(endpoint) {
  return crypto.createHash("sha256").update(endpoint).digest("hex");
}
