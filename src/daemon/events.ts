import type { Actor, Event, EventType } from "../shared/types.js";
import type { StoredReview } from "./storage-types.js";

// Every mutating tool goes through this so an Event and lastSeq can never
// drift apart (design doc §2: "Every state change appends an event,
// whichever side caused it.")
export function appendEvent(
  review: StoredReview,
  actor: Actor,
  type: EventType,
  payload: Record<string, unknown>,
): Event {
  const seq = review.lastSeq + 1;
  const event: Event = { seq, createdAt: new Date().toISOString(), actor, type, payload };
  review.events.push(event);
  review.lastSeq = seq;
  return event;
}
