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
