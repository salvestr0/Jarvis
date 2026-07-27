/**
 * The tools Jarvis (the Telegram bot's Claude agent) can call.
 *
 * Each schema wraps an existing function in src/lib/queries — the whole point
 * of keeping data access there is that the bot and the web app share one
 * implementation. The mapping from name to query function lives in execute.ts.
 *
 * This module is deliberately dependency-free (the type below is local, not
 * imported from @anthropic-ai/sdk) so `node --test` can load it. The shape is
 * structurally compatible with the SDK's Tool type at the call site.
 *
 * Money rule: amounts cross this boundary as STRINGS exactly as the user
 * typed them ("12", "$8.50", "1,200"). parseMoney does the validation —
 * a float here would reintroduce the rounding bugs cents exist to prevent.
 */

export type ToolSchema = {
  name: string
  description: string
  input_schema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
}

const ISO_DATE = { type: 'string', description: 'ISO date, YYYY-MM-DD' }

export const TOOL_SCHEMAS: ToolSchema[] = [
  // --- reads ---------------------------------------------------------------
  {
    name: 'get_net_worth',
    description:
      'Call this when the user asks about their net worth, total wealth, portfolio value, or cash balance. Returns investment totals, cash, and combined net worth in SGD.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_net_worth_history',
    description:
      'Call this when the user asks how their net worth has changed over time or for a trend. Returns dated snapshots, oldest first.',
    input_schema: {
      type: 'object',
      properties: {
        days: {
          type: 'integer',
          description: 'How many most-recent snapshots to return (default 30, max 365)',
        },
      },
    },
  },
  {
    name: 'get_month_summary',
    description:
      'Call this when the user asks about spending, income, or savings for a month ("how much did I spend this month?"). Returns income/expense/net totals and per-category breakdowns.',
    input_schema: {
      type: 'object',
      properties: {
        month: {
          type: 'string',
          description: "Month as YYYY-MM. Omit for the current month.",
        },
      },
    },
  },
  {
    name: 'get_month_transactions',
    description:
      'Call this when the user asks to see individual transactions or wants to find a specific one. Returns up to 50 transactions for the month, newest first.',
    input_schema: {
      type: 'object',
      properties: {
        month: {
          type: 'string',
          description: "Month as YYYY-MM. Omit for the current month.",
        },
      },
    },
  },
  {
    name: 'get_recurring',
    description:
      'Call this when the user asks about subscriptions, bills, insurance, or upcoming/due recurring payments. Returns active recurring items with next due dates and monthly-equivalent costs.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_holdings',
    description:
      'Call this when the user asks about specific investments, coins, stocks, or how a particular holding is doing. Returns each position with current value, cost basis, and gain/loss.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_goals',
    description:
      'Call this when the user asks about their goals or before creating/updating a goal (to find its id). Returns all goals with status and target dates.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_tasks',
    description:
      'Call this when the user asks what tasks or to-dos they have, or before marking one done (to find its id). Returns all tasks, newest first, with done state.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_jobs',
    description:
      'Call this when the user asks about their job, salary, career history, or career wins. Returns jobs (current role first) and logged wins.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_projects',
    description:
      'Call this when the user asks about their side projects, MRR, or project progress. Returns projects with latest metrics and progress toward revenue targets.',
    input_schema: { type: 'object', properties: {} },
  },

  // --- Google, read-only ---------------------------------------------------
  {
    name: 'get_calendar_events',
    description:
      "Call this when the user asks about his schedule, meetings, appointments, or what's on his calendar. Read-only Google Calendar.",
    input_schema: {
      type: 'object',
      properties: {
        days: {
          type: 'integer',
          description: 'How many days ahead to look, from today (default 7, max 60)',
        },
      },
    },
  },
  {
    name: 'search_email',
    description:
      'Call this when the user asks about his email ("any email from the bank?", "unread mail?"). Read-only Gmail search. Supports Gmail query syntax: from:alice, subject:invoice, newer_than:2d, is:unread, has:attachment. Returns sender, subject, date, snippet and an id for get_email.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Gmail search query, e.g. "from:dbs newer_than:7d"',
        },
        max: {
          type: 'integer',
          description: 'Max results (default 5, max 10)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_email',
    description:
      'Call this when the user wants to read a specific email in full. Get the id from search_email first. Read-only.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Message id from search_email' },
      },
      required: ['id'],
    },
  },

  // --- writes --------------------------------------------------------------
  {
    name: 'log_transaction',
    description:
      'Call this when the user wants to record money spent or received ("log $12 lunch", "I got paid $500"). Creates one transaction. Pass the amount exactly as the user wrote it.',
    input_schema: {
      type: 'object',
      properties: {
        direction: {
          type: 'string',
          enum: ['income', 'expense'],
          description: 'expense for money out, income for money in',
        },
        amount: {
          type: 'string',
          description:
            'The amount as the user wrote it, e.g. "12", "$8.50", "1,200". Do NOT convert to a number.',
        },
        category: {
          type: 'string',
          description:
            'Short category name like "Food", "Transport", "Salary". Reuses an existing category or creates it. Omit if unclear.',
        },
        note: { type: 'string', description: 'Optional short note, e.g. "lunch"' },
        date: {
          ...ISO_DATE,
          description: 'When it happened, YYYY-MM-DD. Omit for today. Never a future date.',
        },
      },
      required: ['direction', 'amount'],
    },
  },
  {
    name: 'create_task',
    description:
      'Call this when the user wants to add a task or to-do ("remind me to renew insurance").',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'What needs doing, short' },
        priority: {
          type: 'string',
          enum: ['low', 'medium', 'high'],
          description: 'Default medium',
        },
        due_on: { ...ISO_DATE, description: 'Optional due date, YYYY-MM-DD' },
        note: { type: 'string', description: 'Optional detail' },
      },
      required: ['title'],
    },
  },
  {
    name: 'set_task_done',
    description:
      'Call this when the user says a task is done (or should be reopened). Get the task_id from get_tasks first.',
    input_schema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'The task id from get_tasks' },
        done: {
          type: 'boolean',
          description: 'true to mark done (default), false to reopen',
        },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'create_goal',
    description:
      'Call this when the user wants to set a new goal ("goal: hit $10k savings by December").',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'The goal, short' },
        horizon: {
          type: 'string',
          enum: ['short', 'long'],
          description: 'short = months, long = years. Default short.',
        },
        target_date: { ...ISO_DATE, description: 'Optional target date, YYYY-MM-DD' },
        note: { type: 'string', description: 'Optional detail' },
      },
      required: ['title'],
    },
  },
  {
    name: 'set_goal_status',
    description:
      'Call this when the user achieved or dropped a goal, or wants to reactivate one. Get the goal_id from get_goals first.',
    input_schema: {
      type: 'object',
      properties: {
        goal_id: { type: 'string', description: 'The goal id from get_goals' },
        status: {
          type: 'string',
          enum: ['active', 'achieved', 'dropped'],
        },
      },
      required: ['goal_id', 'status'],
    },
  },
]
