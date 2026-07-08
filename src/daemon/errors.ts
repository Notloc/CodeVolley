// Design doc §6: "errors should teach" — each of these maps to a specific
// HTTP status in server.ts and carries a message meant to be read by Claude,
// not just logged.

export class NotFoundError extends Error {}

export class ValidationError extends Error {}

export class ReviewClosedError extends Error {
  constructor(reviewId: string) {
    super(`Review "${reviewId}" is closed. Call reopen_review first, or resubmit a revision (which reopens it implicitly).`);
  }
}
