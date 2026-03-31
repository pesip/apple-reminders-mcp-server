#!/usr/bin/env node
/**
 * Apple Reminders MCP Server
 *
 * Provides CRUD operations for Apple Reminders via AppleScript.
 * Requires only Automation permission (System Settings > Privacy & Security > Automation),
 * NOT Full Disk Access.
 *
 * Transport: stdio (local integration with Claude Desktop / Cowork)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// AppleScript execution helper
// ---------------------------------------------------------------------------

async function runAppleScript(script: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("osascript", ["-e", script], {
      timeout: 30_000,
      maxBuffer: 5 * 1024 * 1024,
    });
    return stdout.trim();
  } catch (error: unknown) {
    const msg =
      error instanceof Error ? error.message : String(error);

    if (msg.includes("not allowed assistive access") || msg.includes("osascript is not allowed")) {
      throw new Error(
        "Automation permission denied. Grant permission in: " +
        "System Settings > Privacy & Security > Automation. " +
        "Make sure the host app (Terminal / Claude) is allowed to control Reminders."
      );
    }
    throw new Error(`AppleScript error: ${msg}`);
  }
}

// ---------------------------------------------------------------------------
// Escaping helper — prevents AppleScript injection
// ---------------------------------------------------------------------------

function escapeAS(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: "apple-reminders-mcp-server",
  version: "1.0.0",
});

// ========================== reminders_list_lists ===========================

server.registerTool(
  "reminders_list_lists",
  {
    title: "List Reminder Lists",
    description:
      "List all reminder lists (folders) in Apple Reminders. " +
      "Returns the name and id of each list. Use this to discover available lists " +
      "before creating or querying reminders.",
    inputSchema: {},
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async () => {
    const script = `
      tell application "Reminders"
        set output to ""
        repeat with aList in every list
          set output to output & id of aList & "||" & name of aList & linefeed
        end repeat
        return output
      end tell`;

    const raw = await runAppleScript(script);

    if (!raw) {
      return { content: [{ type: "text", text: "No reminder lists found." }] };
    }

    const lists = raw
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [id, ...rest] = line.split("||");
        return { id: id.trim(), name: rest.join("||").trim() };
      });

    return {
      content: [{ type: "text", text: JSON.stringify(lists, null, 2) }],
    };
  }
);

// ========================= reminders_get_reminders =========================

const GetRemindersSchema = z.object({
  list: z
    .string()
    .optional()
    .describe("Name of the reminder list to query. Omit for all lists."),
  include_completed: z
    .boolean()
    .default(false)
    .describe("Include completed reminders (default: false, only incomplete)."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(500)
    .default(50)
    .describe("Maximum number of reminders to return (default 50)."),
});

type GetRemindersInput = z.infer<typeof GetRemindersSchema>;

server.registerTool(
  "reminders_get_reminders",
  {
    title: "Get Reminders",
    description:
      "Retrieve reminders from Apple Reminders. Can filter by list and completion status. " +
      "Returns name, due date, priority, notes, completion status, and list name for each reminder.",
    inputSchema: GetRemindersSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (params: GetRemindersInput) => {
    const completedFilter = params.include_completed
      ? ""
      : "whose completed is false";

    const listTarget = params.list
      ? `list "${escapeAS(params.list)}"`
      : "every list";

    // When querying all lists we need a different loop structure
    const script = params.list
      ? `
      tell application "Reminders"
        set output to ""
        set counter to 0
        set maxItems to ${params.limit}
        repeat with r in (every reminder of list "${escapeAS(params.list)}" ${completedFilter})
          if counter >= maxItems then exit repeat
          set rName to name of r
          set rCompleted to completed of r
          set rPriority to priority of r
          set rNotes to ""
          try
            set rNotes to body of r
          end try
          set rDue to ""
          try
            set rDue to (due date of r) as string
          end try
          set rList to "${escapeAS(params.list)}"
          set output to output & rName & "||" & rCompleted & "||" & rPriority & "||" & rDue & "||" & rNotes & "||" & rList & linefeed
          set counter to counter + 1
        end repeat
        return output
      end tell`
      : `
      tell application "Reminders"
        set output to ""
        set counter to 0
        set maxItems to ${params.limit}
        repeat with aList in every list
          set listName to name of aList
          repeat with r in (every reminder of aList ${completedFilter})
            if counter >= maxItems then exit repeat
            set rName to name of r
            set rCompleted to completed of r
            set rPriority to priority of r
            set rNotes to ""
            try
              set rNotes to body of r
            end try
            set rDue to ""
            try
              set rDue to (due date of r) as string
            end try
            set output to output & rName & "||" & rCompleted & "||" & rPriority & "||" & rDue & "||" & rNotes & "||" & listName & linefeed
            set counter to counter + 1
          end repeat
          if counter >= maxItems then exit repeat
        end repeat
        return output
      end tell`;

    const raw = await runAppleScript(script);

    if (!raw) {
      return { content: [{ type: "text", text: "No reminders found." }] };
    }

    const reminders = raw
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const parts = line.split("||");
        return {
          name: parts[0]?.trim() ?? "",
          completed: parts[1]?.trim() === "true",
          priority: Number(parts[2]?.trim() ?? 0),
          dueDate: parts[3]?.trim() || null,
          notes: parts[4]?.trim() || null,
          list: parts[5]?.trim() ?? "",
        };
      });

    return {
      content: [{ type: "text", text: JSON.stringify(reminders, null, 2) }],
    };
  }
);

// ======================== reminders_create_reminder ========================

const CreateReminderSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(500)
    .describe("Title of the reminder."),
  list: z
    .string()
    .optional()
    .describe("Reminder list name. Omit to use the default list."),
  notes: z
    .string()
    .optional()
    .describe("Additional notes / body text for the reminder."),
  due_date: z
    .string()
    .optional()
    .describe(
      "Due date in ISO 8601 format (e.g. '2026-04-15T09:00:00'). Omit for no due date."
    ),
  priority: z
    .number()
    .int()
    .min(0)
    .max(9)
    .default(0)
    .describe("Priority 0 (none) to 9 (highest). Apple maps: 1-4 = high, 5 = medium, 6-9 = low."),
});

type CreateReminderInput = z.infer<typeof CreateReminderSchema>;

server.registerTool(
  "reminders_create_reminder",
  {
    title: "Create Reminder",
    description:
      "Create a new reminder in Apple Reminders. Optionally set list, due date, priority, and notes.",
    inputSchema: CreateReminderSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async (params: CreateReminderInput) => {
    const listClause = params.list
      ? `of list "${escapeAS(params.list)}"`
      : "of default list";

    let propsClause = `with properties {name:"${escapeAS(params.name)}"`;
    if (params.notes) {
      propsClause += `, body:"${escapeAS(params.notes)}"`;
    }
    if (params.priority > 0) {
      propsClause += `, priority:${params.priority}`;
    }
    propsClause += "}";

    let dueDateScript = "";
    if (params.due_date) {
      dueDateScript = `
        set due date of newReminder to date "${escapeAS(params.due_date)}"`;
    }

    const script = `
      tell application "Reminders"
        set newReminder to make new reminder ${listClause} ${propsClause}${dueDateScript}
        return name of newReminder
      end tell`;

    const result = await runAppleScript(script);

    return {
      content: [
        {
          type: "text",
          text: `Reminder created: "${result}"${params.list ? ` in list "${params.list}"` : ""}`,
        },
      ],
    };
  }
);

// ====================== reminders_complete_reminder ========================

const CompleteReminderSchema = z.object({
  name: z
    .string()
    .min(1)
    .describe("Exact name of the reminder to mark as completed."),
  list: z
    .string()
    .optional()
    .describe("List name to narrow the search. Recommended to avoid ambiguity."),
});

type CompleteReminderInput = z.infer<typeof CompleteReminderSchema>;

server.registerTool(
  "reminders_complete_reminder",
  {
    title: "Complete Reminder",
    description:
      "Mark an existing reminder as completed. Provide the exact reminder name " +
      "and optionally the list name to avoid ambiguity.",
    inputSchema: CompleteReminderSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (params: CompleteReminderInput) => {
    const listFilter = params.list
      ? `of list "${escapeAS(params.list)}"`
      : "";

    const script = `
      tell application "Reminders"
        set matchedReminders to (every reminder ${listFilter} whose name is "${escapeAS(params.name)}" and completed is false)
        if (count of matchedReminders) is 0 then
          return "NOT_FOUND"
        end if
        set completed of item 1 of matchedReminders to true
        return "OK"
      end tell`;

    const result = await runAppleScript(script);

    if (result === "NOT_FOUND") {
      return {
        content: [
          {
            type: "text",
            text: `No incomplete reminder found with name "${params.name}"${params.list ? ` in list "${params.list}"` : ""}. Use reminders_get_reminders to check exact names.`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text",
          text: `Reminder "${params.name}" marked as completed.`,
        },
      ],
    };
  }
);

// ======================== reminders_delete_reminder ========================

const DeleteReminderSchema = z.object({
  name: z
    .string()
    .min(1)
    .describe("Exact name of the reminder to delete."),
  list: z
    .string()
    .optional()
    .describe("List name to narrow the search. Recommended to avoid ambiguity."),
});

type DeleteReminderInput = z.infer<typeof DeleteReminderSchema>;

server.registerTool(
  "reminders_delete_reminder",
  {
    title: "Delete Reminder",
    description:
      "Permanently delete a reminder. This action is irreversible. " +
      "Provide the exact name and optionally the list.",
    inputSchema: DeleteReminderSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async (params: DeleteReminderInput) => {
    const listFilter = params.list
      ? `of list "${escapeAS(params.list)}"`
      : "";

    const script = `
      tell application "Reminders"
        set matchedReminders to (every reminder ${listFilter} whose name is "${escapeAS(params.name)}")
        if (count of matchedReminders) is 0 then
          return "NOT_FOUND"
        end if
        delete item 1 of matchedReminders
        return "OK"
      end tell`;

    const result = await runAppleScript(script);

    if (result === "NOT_FOUND") {
      return {
        content: [
          {
            type: "text",
            text: `No reminder found with name "${params.name}"${params.list ? ` in list "${params.list}"` : ""}. Use reminders_get_reminders to check exact names.`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text",
          text: `Reminder "${params.name}" deleted.`,
        },
      ],
    };
  }
);

// ====================== reminders_update_reminder ==========================

const UpdateReminderSchema = z.object({
  name: z
    .string()
    .min(1)
    .describe("Exact current name of the reminder to update."),
  list: z
    .string()
    .optional()
    .describe("List name to narrow the search."),
  new_name: z
    .string()
    .optional()
    .describe("New name for the reminder."),
  new_notes: z
    .string()
    .optional()
    .describe("New notes / body text. Pass empty string to clear."),
  new_due_date: z
    .string()
    .optional()
    .describe("New due date in ISO 8601 format, or 'none' to remove."),
  new_priority: z
    .number()
    .int()
    .min(0)
    .max(9)
    .optional()
    .describe("New priority (0 = none, 1-4 = high, 5 = medium, 6-9 = low)."),
});

type UpdateReminderInput = z.infer<typeof UpdateReminderSchema>;

server.registerTool(
  "reminders_update_reminder",
  {
    title: "Update Reminder",
    description:
      "Update properties of an existing reminder (name, notes, due date, priority). " +
      "Only provide the fields you want to change.",
    inputSchema: UpdateReminderSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (params: UpdateReminderInput) => {
    const listFilter = params.list
      ? `of list "${escapeAS(params.list)}"`
      : "";

    let updateLines = "";
    if (params.new_name !== undefined) {
      updateLines += `\n        set name of r to "${escapeAS(params.new_name)}"`;
    }
    if (params.new_notes !== undefined) {
      updateLines += `\n        set body of r to "${escapeAS(params.new_notes)}"`;
    }
    if (params.new_priority !== undefined) {
      updateLines += `\n        set priority of r to ${params.new_priority}`;
    }
    if (params.new_due_date !== undefined) {
      if (params.new_due_date === "none") {
        updateLines += `\n        set due date of r to missing value`;
      } else {
        updateLines += `\n        set due date of r to date "${escapeAS(params.new_due_date)}"`;
      }
    }

    if (!updateLines) {
      return {
        content: [{ type: "text", text: "No update fields provided." }],
      };
    }

    const script = `
      tell application "Reminders"
        set matchedReminders to (every reminder ${listFilter} whose name is "${escapeAS(params.name)}")
        if (count of matchedReminders) is 0 then
          return "NOT_FOUND"
        end if
        set r to item 1 of matchedReminders${updateLines}
        return "OK"
      end tell`;

    const result = await runAppleScript(script);

    if (result === "NOT_FOUND") {
      return {
        content: [
          {
            type: "text",
            text: `No reminder found with name "${params.name}"${params.list ? ` in list "${params.list}"` : ""}. Use reminders_get_reminders to check exact names.`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text",
          text: `Reminder "${params.name}" updated successfully.`,
        },
      ],
    };
  }
);

// ====================== reminders_create_list ==============================

const CreateListSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(200)
    .describe("Name for the new reminder list."),
});

type CreateListInput = z.infer<typeof CreateListSchema>;

server.registerTool(
  "reminders_create_list",
  {
    title: "Create Reminder List",
    description: "Create a new reminder list (folder) in Apple Reminders.",
    inputSchema: CreateListSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async (params: CreateListInput) => {
    const script = `
      tell application "Reminders"
        make new list with properties {name:"${escapeAS(params.name)}"}
        return "OK"
      end tell`;

    await runAppleScript(script);

    return {
      content: [
        { type: "text", text: `Reminder list "${params.name}" created.` },
      ],
    };
  }
);

// ====================== reminders_delete_list ==============================

const DeleteListSchema = z.object({
  name: z
    .string()
    .min(1)
    .describe("Exact name of the reminder list to delete. This deletes ALL reminders in it."),
});

type DeleteListInput = z.infer<typeof DeleteListSchema>;

server.registerTool(
  "reminders_delete_list",
  {
    title: "Delete Reminder List",
    description:
      "Permanently delete a reminder list and ALL reminders in it. This is irreversible.",
    inputSchema: DeleteListSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async (params: DeleteListInput) => {
    const script = `
      tell application "Reminders"
        try
          delete list "${escapeAS(params.name)}"
          return "OK"
        on error
          return "NOT_FOUND"
        end try
      end tell`;

    const result = await runAppleScript(script);

    if (result === "NOT_FOUND") {
      return {
        content: [
          {
            type: "text",
            text: `No reminder list found with name "${params.name}".`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text",
          text: `Reminder list "${params.name}" and all its reminders deleted.`,
        },
      ],
    };
  }
);

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Apple Reminders MCP server running via stdio");
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
