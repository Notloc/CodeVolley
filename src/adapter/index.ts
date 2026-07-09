#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as daemon from "./daemon-client.js";

const server = new McpServer({ name: "CodeVolley", version: "0.0.0" });

function toToolError(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

server.registerTool(
  "create_review",
  {
    description: "Create a review and capture revision 1.",
    inputSchema: {
      title: z.string(),
      base: z.string().describe("Required committish — pass a merge-base SHA for branch reviews"),
      head: z.string().optional().describe('Committish, default "WORKTREE"'),
      paths: z.array(z.string()).optional().describe("Optional git pathspecs"),
    },
  },
  async (args) => {
    try {
      const result = await daemon.createReview({
        title: args.title,
        base: args.base,
        head: args.head ?? "WORKTREE",
        paths: args.paths,
      });
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    } catch (err) {
      return toToolError(err);
    }
  },
);

server.registerTool(
  "get_review",
  {
    description: "Full state snapshot of a review — the resume/recovery tool.",
    inputSchema: {
      review: z.string().describe("Review id or title"),
      status: z.array(z.enum(["open", "resolved", "wontfix"])).optional(),
      path: z.string().nullable().optional(),
    },
  },
  async (args) => {
    try {
      const result = await daemon.getReview(args);
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    } catch (err) {
      return toToolError(err);
    }
  },
);

server.registerTool(
  "create_thread",
  {
    description: "Create a comment thread anchored to a line (or range) in the latest revision.",
    inputSchema: {
      review: z.string().describe("Review id or title"),
      path: z.string(),
      line: z.number().int().positive(),
      end_line: z.number().int().positive().nullable().optional(),
      side: z.enum(["NEW", "OLD"]).optional().describe('Default "NEW"'),
      severity: z.enum(["issue", "suggestion", "question", "nit", "praise"]),
      title: z.string().describe("Collapsed one-line summary shown in the UI"),
      body: z.string().describe("Full first comment — markdown, may include code blocks"),
      suggestion: z.string().nullable().optional().describe("Optional replacement code for the anchored range"),
    },
  },
  async (args) => {
    try {
      const result = await daemon.createThread(args);
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    } catch (err) {
      return toToolError(err);
    }
  },
);

server.registerTool(
  "reply",
  {
    description: "Reply to a thread, optionally transitioning its status in the same call.",
    inputSchema: {
      review: z.string(),
      thread: z.string(),
      body: z.string(),
      status: z.enum(["open", "resolved", "wontfix"]).optional(),
    },
  },
  async (args) => {
    try {
      const result = await daemon.reply(args);
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    } catch (err) {
      return toToolError(err);
    }
  },
);

server.registerTool(
  "edit_comment",
  {
    description:
      "Edit one of your own comments. Truncates every comment after it in the thread, since later replies may have responded to the old text.",
    inputSchema: {
      review: z.string(),
      thread: z.string(),
      comment: z.string(),
      body: z.string(),
    },
  },
  async (args) => {
    try {
      const result = await daemon.editComment(args);
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    } catch (err) {
      return toToolError(err);
    }
  },
);

server.registerTool(
  "set_status",
  {
    description: "Change a thread's status without adding a comment.",
    inputSchema: {
      review: z.string(),
      thread: z.string(),
      status: z.enum(["open", "resolved", "wontfix"]),
    },
  },
  async (args) => {
    try {
      const result = await daemon.setStatus(args);
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    } catch (err) {
      return toToolError(err);
    }
  },
);

server.registerTool(
  "focus_thread",
  {
    description:
      "Declare the thread you're turning your attention to — the reviewer sees 'Claude is thinking…' on it (instead of the passive 'Waiting for Claude…'). Call it right before working a thread's feedback. Focus moves when you call this on another thread, and clears when you reply to, close, or acknowledge the focused thread.",
    inputSchema: {
      review: z.string(),
      thread: z.string(),
    },
  },
  async (args) => {
    try {
      const result = await daemon.focusThread(args);
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    } catch (err) {
      return toToolError(err);
    }
  },
);

server.registerTool(
  "acknowledge_thread",
  {
    description:
      "Clear a thread's 'awaiting Claude' flag without replying — use when the user's latest comment warrants no response (e.g. an acknowledgement or praise). Does not change the thread's status.",
    inputSchema: {
      review: z.string(),
      thread: z.string(),
    },
  },
  async (args) => {
    try {
      const result = await daemon.acknowledgeThread(args);
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    } catch (err) {
      return toToolError(err);
    }
  },
);

server.registerTool(
  "post_note",
  {
    description: "Post a review-level note not anchored to any line (progress ticker, summary, or directive).",
    inputSchema: {
      review: z.string(),
      kind: z.enum(["progress", "summary", "note"]),
      body: z.string(),
    },
  },
  async (args) => {
    try {
      const result = await daemon.postNote(args);
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    } catch (err) {
      return toToolError(err);
    }
  },
);

server.registerTool(
  "close_review",
  {
    description: "Post a closing summary and mark the review closed.",
    inputSchema: {
      review: z.string(),
      summary: z.string().describe("Markdown closing summary"),
    },
  },
  async (args) => {
    try {
      const result = await daemon.closeReview(args);
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    } catch (err) {
      return toToolError(err);
    }
  },
);

server.registerTool(
  "reopen_review",
  {
    description: "Explicitly reopen a closed review without submitting a new revision.",
    inputSchema: {
      review: z.string(),
    },
  },
  async (args) => {
    try {
      const result = await daemon.reopenReview(args);
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    } catch (err) {
      return toToolError(err);
    }
  },
);

server.registerTool(
  "submit_revision",
  {
    description:
      "Capture a new immutable revision and re-anchor open threads. Check the `outdated` list in the result — those threads need re-inspection.",
    inputSchema: {
      review: z.string(),
      message: z.string().describe("e.g. \"Fixes from threads t-4, t-7\""),
      base: z.string().optional().describe("Defaults to the previous revision's base"),
      head: z.string().optional().describe("Defaults to the previous revision's head"),
      paths: z.array(z.string()).optional().describe("Defaults to the previous revision's paths"),
    },
  },
  async (args) => {
    try {
      const result = await daemon.submitRevision(args);
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    } catch (err) {
      return toToolError(err);
    }
  },
);

server.registerTool(
  "wait_for_activity",
  {
    description:
      "Long-polls for user-actor activity on a review past a cursor. Returns immediately if events already exist past `after`; otherwise waits for one to arrive or times out. On timeout, just call again — the empty-timeout / re-call loop is the idle state of an interactive session.",
    inputSchema: {
      review: z.string(),
      after: z.number().int().nonnegative().describe("Event seq cursor — pass the review's lastSeq from the previous call"),
      timeout_seconds: z.number().int().positive().optional().describe("Default 90, capped at 100"),
    },
  },
  async (args) => {
    try {
      const result = await daemon.waitForActivity(args);
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    } catch (err) {
      return toToolError(err);
    }
  },
);

// Heartbeat while this session is connected so the UI can show "Claude is
// working" vs "no session running" (see daemon waiters.isOnline). unref() so
// it never keeps the process alive on its own.
void daemon.heartbeat();
setInterval(() => void daemon.heartbeat(), 5000).unref();

const transport = new StdioServerTransport();
await server.connect(transport);
