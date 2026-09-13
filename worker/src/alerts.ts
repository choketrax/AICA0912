export interface SCPEvent {
  type: string;
  timestamp: string;
  request?: any;
  decision?: any;
  cost_usd?: number;
}

export type AlertLevel = "info" | "warning" | "critical" | "emergency";

export interface Alert {
  level: AlertLevel;
  scope: string;
  scope_id: string;
  rule_id: string;
  title: string;
  message: string;
  value: number;
  threshold: number;
  timestamp: string;
}

export interface SCPEnv {
  DB: any;
  SLACK_WEBHOOK_URL?: string;
  SCP_EVENTS: any;
}

export async function handleScheduled(
  event: any,
  env: SCPEnv,
): Promise<void> {
  // Ignored for now
}

export async function handleQueue(
  batch: any,
  env: SCPEnv,
): Promise<void> {
  const period = new Date().toISOString().substring(0, 7);

  for (const message of batch.messages) {
    try {
      const event: any = message.body;
      const eventId = event?.event_id;
      
      if (eventId) {
        const alreadyProcessed = await env.DB.prepare(
          `SELECT 1 FROM scp_policy_log WHERE log_id = ? LIMIT 1`
        ).bind(eventId).first();
        
        if (alreadyProcessed) {
          message.ack();
          continue;
        }
      }

      if (event.type === 'proxy_completion') {
        const orgId = event.customer_id || "global";
        const deptId = event.project_id;
        const agentId = event.agent_id;
        const costUsd = (event.cost_usd || 0).toString();
        const timestamp = event.timestamp || new Date().toISOString();
        
        // 1. Record decision to scp_policy_log
        await env.DB.prepare(
          `
          INSERT OR IGNORE INTO scp_policy_log (log_id, request_id, scope, scope_id, action, rule_id, evaluated_at, cost_usd)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `
        )
          .bind(
            eventId || crypto.randomUUID(),
            event.request_id || "unknown",
            "org",
            orgId,
            event.action || "allow",
            event.rule_id || null,
            timestamp,
            costUsd
          )
          .run();

        // 2. Insert into append-only scp_budget_ledger for Org
        await env.DB.prepare(
          `
          INSERT INTO scp_budget_ledger (ledger_id, scope, scope_id, period, cost_usd, customer_id, project_id, agent_id, recorded_at)
          VALUES (?, 'org', ?, ?, ?, ?, ?, ?, ?)
        `
        )
          .bind(crypto.randomUUID(), orgId, period, costUsd, orgId, deptId || null, agentId || null, timestamp)
          .run();

        // 3. Dept
        if (deptId) {
          await env.DB.prepare(
            `
            INSERT INTO scp_budget_ledger (ledger_id, scope, scope_id, period, cost_usd, customer_id, project_id, agent_id, recorded_at)
            VALUES (?, 'dept', ?, ?, ?, ?, ?, ?, ?)
          `
          )
            .bind(crypto.randomUUID(), deptId, period, costUsd, orgId, deptId, agentId || null, timestamp)
            .run();
        }

        // 4. Agent
        if (agentId) {
          await env.DB.prepare(
            `
            INSERT INTO scp_budget_ledger (ledger_id, scope, scope_id, period, cost_usd, customer_id, project_id, agent_id, recorded_at)
            VALUES (?, 'agent', ?, ?, ?, ?, ?, ?, ?)
          `
          )
            .bind(crypto.randomUUID(), agentId, period, costUsd, orgId, deptId, agentId, timestamp)
            .run();
        }
      }

      message.ack();
    } catch (error) {
      console.error("Failed processing queue message:", error);
    }
  }
}
