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

  // --- memory --------------------------------------------------------------
  {
    name: 'remember',
    description:
      'Call this when the user tells you something durable about himself worth keeping — a preference, a person, a date, a budget, a routine ("my mom\'s birthday is March 3", "keep food under $600/month"). Store ONE self-contained fact per call, worded to make sense months later. Do not store things the tracker already records (transactions, tasks, goals).',
    input_schema: {
      type: 'object',
      properties: {
        fact: {
          type: 'string',
          description:
            'The fact, one sentence, self-contained (max 500 chars). Include names and absolute dates, not "next week".',
        },
      },
      required: ['fact'],
    },
  },
  {
    name: 'forget',
    description:
      'Call this when a remembered fact is wrong, outdated, or the user asks you to forget it. The fact ids are listed in your context. When a fact changed, forget the old one AND remember the corrected one.',
    input_schema: {
      type: 'object',
      properties: {
        fact_id: {
          type: 'string',
          description: 'The id of the fact to delete, from the facts list in your context',
        },
      },
      required: ['fact_id'],
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
    name: 'set_project_status',
    description:
      'Call this when the user says a project changed stage ("mark X as launched", "pause Y"). Get the project_id from get_projects first.',
    input_schema: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'The project id from get_projects' },
        status: {
          type: 'string',
          enum: ['idea', 'building', 'beta', 'launched', 'paused', 'archived'],
        },
      },
      required: ['project_id', 'status'],
    },
  },
  {
    name: 'record_project_metric',
    description:
      "Call this when the user reports a project's numbers (\"X hit $200 MRR\", \"Y has 50 users now\"). Records today's MRR and user count for the project; recording twice on the same day overwrites. Get the project_id from get_projects first.",
    input_schema: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'The project id from get_projects' },
        mrr: {
          type: 'string',
          description:
            'Monthly recurring revenue as the user wrote it, e.g. "200", "$1,250.50", or "0". Do NOT convert to a number.',
        },
        users: {
          type: 'integer',
          description: 'Current user count. Omit if not mentioned.',
        },
      },
      required: ['project_id', 'mrr'],
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

  // --- updates (confirm when inferring) -------------------------------------
  {
    name: 'update_task',
    description:
      'Call this when the user wants to change a task — title, priority, due date, or note. Only pass the fields that change. Get the task_id from get_tasks first.',
    input_schema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'The task id from get_tasks' },
        title: { type: 'string' },
        priority: { type: 'string', enum: ['low', 'medium', 'high'] },
        due_on: { ...ISO_DATE, description: 'New due date YYYY-MM-DD, or "none" to clear' },
        note: { type: 'string' },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'update_goal',
    description:
      'Call this when the user wants to change a goal — title, horizon, target date, or note. Only pass the fields that change. Get the goal_id from get_goals first.',
    input_schema: {
      type: 'object',
      properties: {
        goal_id: { type: 'string', description: 'The goal id from get_goals' },
        title: { type: 'string' },
        horizon: { type: 'string', enum: ['short', 'long'] },
        target_date: { ...ISO_DATE, description: 'New target date YYYY-MM-DD, or "none" to clear' },
        note: { type: 'string' },
      },
      required: ['goal_id'],
    },
  },
  {
    name: 'create_recurring',
    description:
      'Call this when the user wants to track a new subscription, bill, or other recurring payment ("track my $19 Netflix monthly").',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'e.g. "Netflix"' },
        direction: { type: 'string', enum: ['income', 'expense'], description: 'Default expense' },
        amount: {
          type: 'string',
          description: 'Amount per billing period as the user wrote it. Do NOT convert to a number.',
        },
        cadence: { type: 'string', enum: ['weekly', 'monthly', 'yearly'] },
        next_due: { ...ISO_DATE, description: 'When the next payment is due, YYYY-MM-DD' },
        category: { type: 'string', description: 'Optional category name, e.g. "Entertainment"' },
      },
      required: ['name', 'amount', 'cadence', 'next_due'],
    },
  },
  {
    name: 'update_recurring',
    description:
      'Call this when a recurring payment changes — new price, cadence, name, or due date ("Netflix went up to $19"). Only pass the fields that change. Get the recurring_id from get_recurring first.',
    input_schema: {
      type: 'object',
      properties: {
        recurring_id: { type: 'string', description: 'The id from get_recurring' },
        name: { type: 'string' },
        amount: { type: 'string', description: 'New amount as the user wrote it' },
        cadence: { type: 'string', enum: ['weekly', 'monthly', 'yearly'] },
        next_due: ISO_DATE,
      },
      required: ['recurring_id'],
    },
  },
  {
    name: 'log_recurring_payment',
    description:
      'Call this when the user says a recurring bill was paid ("paid my insurance"). Records the real transaction and advances the next due date by one period. Get the recurring_id from get_recurring first.',
    input_schema: {
      type: 'object',
      properties: {
        recurring_id: { type: 'string', description: 'The id from get_recurring' },
      },
      required: ['recurring_id'],
    },
  },
  {
    name: 'create_holding',
    description:
      'Call this when the user bought or wants to track a new investment ("I bought 0.1 ETH at $250"). For insurance/investment-linked plans with no ticker use kind "manual" with a manual_value.',
    input_schema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['crypto', 'stock', 'manual'] },
        symbol: { type: 'string', description: 'Ticker like BTC or AAPL; short label for manual' },
        name: { type: 'string', description: 'Optional display name' },
        quantity: {
          type: 'string',
          description: 'Units held as the user wrote it, e.g. "0.1", "12". Default "1" for manual.',
        },
        cost_basis: {
          type: 'string',
          description: 'TOTAL amount paid, as written. "0" allowed (airdrop/gift).',
        },
        cost_currency: { type: 'string', description: 'Default USD for crypto/stock, SGD for manual' },
        manual_value: {
          type: 'string',
          description: 'Manual kind only: current value in SGD, as written',
        },
      },
      required: ['kind', 'symbol'],
    },
  },
  {
    name: 'update_holding',
    description:
      'Call this when a holding changes — more units bought (new total quantity and cost basis), or a manual plan revalued. Only pass the fields that change. Get the holding_id from get_holdings first.',
    input_schema: {
      type: 'object',
      properties: {
        holding_id: { type: 'string', description: 'The id from get_holdings' },
        quantity: { type: 'string', description: 'New TOTAL units held, as written' },
        cost_basis: { type: 'string', description: 'New TOTAL cost basis, as written. "0" allowed.' },
        manual_value: { type: 'string', description: 'New current value (manual kind), as written' },
        name: { type: 'string' },
        note: { type: 'string' },
      },
      required: ['holding_id'],
    },
  },
  {
    name: 'get_accounts',
    description:
      'Call this when the user asks about his accounts (bank, cash, brokerage) or before creating/updating one (to find its id). Returns each with opening balance.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'create_account',
    description:
      'Call this when the user wants to track a new account ("add my DBS account with $2,000").',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'e.g. "DBS Savings"' },
        kind: { type: 'string', enum: ['cash', 'bank', 'brokerage', 'crypto_wallet', 'other'] },
        opening_balance: {
          type: 'string',
          description: 'Balance when tracking starts, as written. "0" allowed.',
        },
      },
      required: ['name', 'kind'],
    },
  },
  {
    name: 'update_account',
    description:
      'Call this when an account changes — rename or corrected opening balance. Only pass the fields that change. Get the account_id from get_accounts first.',
    input_schema: {
      type: 'object',
      properties: {
        account_id: { type: 'string', description: 'The id from get_accounts' },
        name: { type: 'string' },
        kind: { type: 'string', enum: ['cash', 'bank', 'brokerage', 'crypto_wallet', 'other'] },
        opening_balance: { type: 'string', description: 'Corrected opening balance, as written' },
      },
      required: ['account_id'],
    },
  },
  {
    name: 'create_job',
    description:
      'Call this when the user starts a new job or wants a past role recorded.',
    input_schema: {
      type: 'object',
      properties: {
        employer: { type: 'string' },
        title: { type: 'string' },
        started_on: { ...ISO_DATE, description: 'Start date YYYY-MM-DD. Default today.' },
        salary: { type: 'string', description: 'Salary as written, e.g. "3200". Omit if unknown.' },
        salary_period: { type: 'string', enum: ['monthly', 'annual'], description: 'Default monthly' },
      },
      required: ['employer', 'title'],
    },
  },
  {
    name: 'update_job',
    description:
      'Call this when job details change — a raise ("my salary is now $3,500"), new title, or the role ended. Only pass the fields that change. Get the job_id from get_jobs first.',
    input_schema: {
      type: 'object',
      properties: {
        job_id: { type: 'string', description: 'The id from get_jobs' },
        employer: { type: 'string' },
        title: { type: 'string' },
        salary: { type: 'string', description: 'New salary as written' },
        salary_period: { type: 'string', enum: ['monthly', 'annual'] },
        ended_on: { ...ISO_DATE, description: 'End date YYYY-MM-DD, or "current" if still employed' },
      },
      required: ['job_id'],
    },
  },
  {
    name: 'create_win',
    description:
      'Call this when the user shipped or achieved something at work worth logging ("shipped the pricing revamp today").',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'The win, short' },
        detail: { type: 'string', description: 'Optional context' },
        date: { ...ISO_DATE, description: 'When it happened. Default today.' },
      },
      required: ['title'],
    },
  },
  {
    name: 'create_project',
    description:
      'Call this when the user starts a new side project worth tracking.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        kind: { type: 'string', enum: ['product', 'content', 'business'], description: 'Default product' },
        status: {
          type: 'string',
          enum: ['idea', 'building', 'beta', 'launched', 'paused', 'archived'],
          description: 'Default idea',
        },
        mrr_target: { type: 'string', description: 'Optional monthly revenue target, as written' },
        url: { type: 'string' },
      },
      required: ['name'],
    },
  },
  {
    name: 'update_project',
    description:
      'Call this when project details change — name, kind, revenue target, URL, or launch date. For status use set_project_status; for MRR numbers use record_project_metric. Get the project_id from get_projects first.',
    input_schema: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'The id from get_projects' },
        name: { type: 'string' },
        kind: { type: 'string', enum: ['product', 'content', 'business'] },
        mrr_target: { type: 'string', description: 'New target as written. "0" = no target.' },
        url: { type: 'string' },
        launch_date: ISO_DATE,
      },
      required: ['project_id'],
    },
  },

  // --- deletes (ALWAYS get explicit confirmation first) ----------------------
  {
    name: 'delete_transaction',
    description:
      'Call this when Jayden has explicitly confirmed in this conversation which transaction to delete. Destructive, no undo. Get the transaction_id from get_month_transactions first.',
    input_schema: {
      type: 'object',
      properties: {
        transaction_id: { type: 'string', description: 'The id from get_month_transactions' },
      },
      required: ['transaction_id'],
    },
  },
  {
    name: 'delete_task',
    description:
      'Call this when Jayden has explicitly confirmed deleting this task (to complete one, use set_task_done instead). Destructive, no undo.',
    input_schema: {
      type: 'object',
      properties: { task_id: { type: 'string' } },
      required: ['task_id'],
    },
  },
  {
    name: 'delete_goal',
    description:
      'Call this when Jayden has explicitly confirmed deleting this goal (for an abandoned goal prefer set_goal_status "dropped", which keeps history). Destructive, no undo.',
    input_schema: {
      type: 'object',
      properties: { goal_id: { type: 'string' } },
      required: ['goal_id'],
    },
  },
  {
    name: 'delete_recurring',
    description:
      'Call this when Jayden has explicitly confirmed cancelling this recurring payment ("I cancelled Netflix"). Destructive, no undo — past logged transactions stay.',
    input_schema: {
      type: 'object',
      properties: { recurring_id: { type: 'string' } },
      required: ['recurring_id'],
    },
  },
  {
    name: 'delete_holding',
    description:
      'Call this when Jayden has explicitly confirmed he sold or wants to stop tracking this holding. Destructive, no undo.',
    input_schema: {
      type: 'object',
      properties: { holding_id: { type: 'string' } },
      required: ['holding_id'],
    },
  },
  {
    name: 'delete_job',
    description:
      'Call this when Jayden has explicitly confirmed deleting this job record (if the role just ended, use update_job with ended_on instead). Destructive, no undo.',
    input_schema: {
      type: 'object',
      properties: { job_id: { type: 'string' } },
      required: ['job_id'],
    },
  },
  {
    name: 'delete_win',
    description:
      'Call this when Jayden has explicitly confirmed deleting this career win. Destructive, no undo.',
    input_schema: {
      type: 'object',
      properties: { win_id: { type: 'string' } },
      required: ['win_id'],
    },
  },
  {
    name: 'delete_project',
    description:
      'Call this when Jayden has explicitly confirmed deleting this project and its metrics (prefer set_project_status "archived", which keeps history). Destructive, no undo.',
    input_schema: {
      type: 'object',
      properties: { project_id: { type: 'string' } },
      required: ['project_id'],
    },
  },
  {
    name: 'archive_account',
    description:
      'Call this when Jayden has explicitly confirmed closing this account. Soft delete: it disappears from lists but its transaction history stays.',
    input_schema: {
      type: 'object',
      properties: { account_id: { type: 'string' } },
      required: ['account_id'],
    },
  },
]
