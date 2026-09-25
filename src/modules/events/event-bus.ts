// In-process pub/sub bus. Every interesting bot/customer moment (message in,
// bot reply, order created, payment verified, user blocked) is published here.
// The admin panel subscribes via SSE and the push service turns events into
// phone notifications. Single-process deployment keeps this trivial and fast.

export type VexEventType =
  | "message_in"
  | "message_out"
  | "typing" // received but not yet answered
  | "order_created"
  | "payment_verified"
  | "payment_review"
  | "handoff_on"
  | "handoff_off"
  | "user_blocked"
  | "user_unblocked";

export interface VexEvent {
  type: VexEventType;
  jid: string;
  phone: string;
  name?: string;
  preview?: string;
  meta?: Record<string, unknown>;
  at: string;
}

type Listener = (event: VexEvent) => void;

const listeners = new Set<Listener>();
const recent: VexEvent[] = [];

export function publishEvent(event: Omit<VexEvent, "at"> & { at?: string }): VexEvent {
  const full: VexEvent = { ...event, at: event.at ?? new Date().toISOString() };
  recent.push(full);
  if (recent.length > 200) recent.shift();
  for (const listener of listeners) {
    try {
      listener(full);
    } catch {
      // A broken subscriber must never break the sales flow.
    }
  }
  return full;
}

export function subscribeEvents(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function recentEvents(limit = 40): VexEvent[] {
  return recent.slice(-limit).reverse();
}

// Events that deserve a phone notification by default.
export const NOTIFY_EVENTS: Set<VexEventType> = new Set([
  "message_in",
  "order_created",
  "payment_verified",
  "payment_review",
  "handoff_on",
  "user_blocked",
]);
