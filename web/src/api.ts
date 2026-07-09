import type { Section } from "./sections.js";
import type { FileContent, Review, ReviewEvent, ReviewSummary, Severity, Side, ThreadStatus } from "./types.js";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body as T;
}

const jsonPost = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export function listReviews(): Promise<ReviewSummary[]> {
  return request(`/internal/reviews`);
}

export function getConfig(): Promise<{ sections: Section[] }> {
  return request(`/api/config`);
}

export function getReview(idOrTitle: string): Promise<Review> {
  return request(`/internal/reviews/${encodeURIComponent(idOrTitle)}`);
}

export function getFileContent(reviewId: string, revision: number, path: string): Promise<FileContent> {
  return request(
    `/api/reviews/${encodeURIComponent(reviewId)}/revisions/${revision}/file?path=${encodeURIComponent(path)}`,
  );
}

export function createThread(
  reviewId: string,
  input: {
    path: string;
    line: number;
    end_line?: number | null;
    side?: Side;
    severity: Severity;
    title: string;
    body: string;
    suggestion?: string | null;
  },
): Promise<{ thread: string }> {
  return request(`/api/reviews/${encodeURIComponent(reviewId)}/threads`, jsonPost(input));
}

export function reply(
  reviewId: string,
  threadId: string,
  body: string,
  status?: ThreadStatus,
): Promise<{ thread: string; status: ThreadStatus }> {
  return request(`/api/reviews/${encodeURIComponent(reviewId)}/threads/${encodeURIComponent(threadId)}/replies`, jsonPost({ body, status }));
}

export function editComment(
  reviewId: string,
  threadId: string,
  commentId: string,
  body: string,
): Promise<{ thread: string; comments: unknown[] }> {
  return request(
    `/api/reviews/${encodeURIComponent(reviewId)}/threads/${encodeURIComponent(threadId)}/comments/${encodeURIComponent(commentId)}`,
    { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body }) },
  );
}

export function setStatus(reviewId: string, threadId: string, status: ThreadStatus): Promise<{ thread: string; status: ThreadStatus }> {
  return request(`/api/reviews/${encodeURIComponent(reviewId)}/threads/${encodeURIComponent(threadId)}/status`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
}

export function postNote(reviewId: string, kind: "note", body: string): Promise<{ note: string }> {
  return request(`/api/reviews/${encodeURIComponent(reviewId)}/notes`, jsonPost({ kind, body }));
}

export function closeReview(reviewId: string, summary: string): Promise<{ review: string; status: "closed" }> {
  return request(`/api/reviews/${encodeURIComponent(reviewId)}/close`, jsonPost({ summary }));
}

export function markDone(reviewId: string): Promise<{ review: string }> {
  return request(`/api/reviews/${encodeURIComponent(reviewId)}/done`, jsonPost({}));
}

export function getPresence(reviewId: string): Promise<{ listening: boolean; online: boolean }> {
  return request(`/api/reviews/${encodeURIComponent(reviewId)}/presence`);
}

export function getEvents(reviewId: string): Promise<ReviewEvent[]> {
  return request(`/api/reviews/${encodeURIComponent(reviewId)}/events`);
}

export function subscribeToReviewStream(reviewId: string, after: number, onEvent: (event: ReviewEvent) => void): () => void {
  const source = new EventSource(`/api/reviews/${encodeURIComponent(reviewId)}/stream?after=${after}`);
  const handler = (e: MessageEvent) => onEvent(JSON.parse(e.data));
  const types: ReviewEvent["type"][] = [
    "thread_created",
    "comment_added",
    "comment_edited",
    "thread_status_changed",
    "note_added",
    "revision_submitted",
    "user_done",
    "review_closed",
    "review_reopened",
  ];
  for (const type of types) source.addEventListener(type, handler);
  return () => source.close();
}
