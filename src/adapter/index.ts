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

const transport = new StdioServerTransport();
await server.connect(transport);
