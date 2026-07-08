import { useEffect, useState } from "react";
import * as api from "../api.js";
import type { ReviewSummary } from "../types.js";

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function ReviewPicker() {
  const [reviews, setReviews] = useState<ReviewSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listReviews().then(setReviews).catch((err) => setError(String(err.message ?? err)));
  }, []);

  if (error) return <div className="error">Failed to load reviews: {error}</div>;
  if (!reviews) return <div className="loading">Loading reviews…</div>;
  if (reviews.length === 0) {
    return <p className="empty">No reviews yet in this repo's .codevolley/ — Claude creates one with create_review.</p>;
  }

  return (
    <ul className="review-picker">
      {reviews.map((r) => (
        <li key={r.id}>
          <a href={`/review/${encodeURIComponent(r.id)}`}>
            <span className={`status status-${r.status}`}>{r.status}</span>
            <span className="review-picker-title">{r.title}</span>
            <span className="review-picker-meta">{timeAgo(r.createdAt)}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}
