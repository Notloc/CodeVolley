import { EventEmitter } from "node:events";

// In-process pub/sub keyed by review id, so wait_for_activity can block
// until writeReview() persists a new event for that review rather than
// polling. All writes go through this same daemon process (design doc:
// "the UI daemon... owns .codevolley/"), so an in-memory emitter is enough
// — no cross-process coordination needed.
const emitter = new EventEmitter();
emitter.setMaxListeners(0); // many concurrent long-polls across many reviews/threads is normal, not a leak

export function notifyReviewActivity(reviewId: string): void {
  emitter.emit(reviewId);
}

export function waitForReviewActivity(reviewId: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      emitter.off(reviewId, onActivity);
      resolve();
    }, timeoutMs);
    function onActivity() {
      clearTimeout(timer);
      resolve();
    }
    emitter.once(reviewId, onActivity);
  });
}

// Presence (design doc §5): true while a wait_for_activity call is
// currently parked on this review — the UI shows "Claude is listening" vs
// "Claude is working" off this.
const listening = new Set<string>();

export function setListening(reviewId: string, isListening: boolean): void {
  if (isListening) listening.add(reviewId);
  else listening.delete(reviewId);
}

export function isListening(reviewId: string): boolean {
  return listening.has(reviewId);
}

// Adapter liveness: the MCP adapter pings while a Claude session is connected.
// Lets the UI tell "actively working" from "no session running" — both
// otherwise present as not-listening. Global (per daemon/repo), not per-review.
const ONLINE_TTL_MS = 15_000;
let lastHeartbeatAt = 0;

export function recordHeartbeat(): void {
  lastHeartbeatAt = Date.now();
}

export function isOnline(): boolean {
  return Date.now() - lastHeartbeatAt < ONLINE_TTL_MS;
}
