import { BaseEnv } from "./control";

export interface SCPEnv extends BaseEnv {
  SCP_EVENTS: Queue;
  SLACK_WEBHOOK_URL?: string;
  EMAIL_FROM?: string;
  PORTKEY_API_KEY?: string;
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

export interface SCPEvent {
  type: string;
  timestamp: string;
  request?: any;
  decision?: any;
  cost_usd?: number;
}

async function sendSlackAlert(webhookUrl: string, alert: Alert): Promise<void> {
  if (!webhookUrl) return;

  const colorMap: Record<AlertLevel, string> = {
    info: "#36a64f",
    warning: "#ffcc00",
    critical: "#ff3333",
    emergency: "#990000",
  };

  const payload = {
    attachments: [
      {
        color: colorMap[alert.level],
        title: `[${alert.level.toUpperCase()}] ${alert.title}`,
        text: alert.message,
        fields: [
          {
            title: "Scope",
            value: `${alert.scope}: ${alert.scope_id}`,
            short: true,
          },
          { title: "Rule", value: alert.rule_id, short: true },
          {
            title: "Value / Threshold",
            value: `${alert.value.toFixed(2)} / ${alert.threshold.toFixed(2)}`,
            short: true,
          },
          { title: "Time", value: alert.timestamp, short: true },
        ],
      },
    ],
  };

  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    console.error("Failed to send Slack alert:", error);
  }
}

export async function handleScheduled(
  event: ScheduledEvent,
  env: SCPEnv,
): Promise<void> {
  const period = new Date().toISOString().substring(0, 7);

  try {
    // 1 & 2. Query budget consumption for active policies
    const { results: budgets } = await env.DB.prepare(
      `
      SELECT scope, scope_id, spent_usd, budget_usd, warning_threshold_pct, block_threshold_pct 
      FROM scp_budget_ledger 
      WHERE period = ?
    `,
    )
      .bind(period)
      .all();

    for (const b of budgets) {
      const spent = b.spent_usd as number;
      const budget = b.budget_usd as number;
      const pct = budget > 0 ? (spent / budget) * 100 : 0;

      let level: AlertLevel | null = null;
      let threshold = 0;
      let title = "";

      // 3. Check thresholds (100% exceeded, 90% escalation, 75% warning)
      if (pct >= 100) {
        level = "emergency";
        threshold = 100;
        title = "Budget Exceeded";
      } else if (pct >= 90) {
        level = "critical";
        threshold = 90;
        title = "Budget Critical Escalation";
      } else if (pct >= (b.warning_threshold_pct as number)) {
        level = "warning";
        threshold = b.warning_threshold_pct as number;
        title = "Budget Warning Threshold Reached";
      }

      if (level && env.SLACK_WEBHOOK_URL) {
        await sendSlackAlert(env.SLACK_WEBHOOK_URL, {
          level,
          scope: b.scope as string,
          scope_id: b.scope_id as string,
          rule_id: "BUDGET_MONITOR",
          title,
          message: `${b.scope} ${b.scope_id} has reached ${pct.toFixed(1)}% of its budget.`,
          value: pct,
          threshold,
          timestamp: new Date().toISOString(),
        });
      }
    }

    // 4. Update circuit breaker state based on anomaly counts / quality / failures
    const { results: circuits } = await env.DB.prepare(
      `
      SELECT scope, scope_id, consecutive_failures 
      FROM scp_circuit_state 
      WHERE state = 'closed' AND consecutive_failures >= 3
    `,
    ).all();

    for (const c of circuits) {
      const scope = c.scope as string;
      const scopeId = c.scope_id as string;
      const failures = c.consecutive_failures as number;

      // MOCKing complex aggregated conditions: cost_anomaly_count > 0 or low_quality_count >= 3
      // For this implementation, we simply trip if consecutive_failures >= 5
      if (failures >= 5) {
        await env.DB.prepare(
          `
          UPDATE scp_circuit_state 
          SET state = 'open', open_reason = 'Excessive consecutive failures', open_at = ?, requires_approval = true 
          WHERE scope = ? AND scope_id = ?
        `,
        )
          .bind(new Date().toISOString(), scope, scopeId)
          .run();

        // 5. Send approval request / alert
        if (env.SLACK_WEBHOOK_URL) {
          await sendSlackAlert(env.SLACK_WEBHOOK_URL, {
            level: "critical",
            scope,
            scope_id: scopeId,
            rule_id: "CIRCUIT_BREAKER_TRIPPED",
            title: "Circuit Breaker Opened",
            message: `Circuit breaker opened for ${scope} ${scopeId} due to excessive failures. Approval required to reset.`,
            value: failures,
            threshold: 5,
            timestamp: new Date().toISOString(),
          });
        }
      }
    }
  } catch (error) {
    console.error("Error in handleScheduled:", error);
  }
}

export async function handleQueue(
  batch: MessageBatch<SCPEvent>,
  env: SCPEnv,
): Promise<void> {
  const period = new Date().toISOString().substring(0, 7);

  for (const message of batch.messages) {
    try {
      const event: any = message.body;
      const eventId = event?.event_id;
      if (eventId) {
        const alreadyProcessed = await env.DB.prepare(
          `SELECT 1 FROM scp_policy_log WHERE event_id = ? LIMIT 1`
        ).bind(eventId).first();
        
        if (alreadyProcessed) {
          console.log(`[SCP] Duplicate queue event skipped: ${eventId}`);
          message.ack();
          continue;
        }
      }

      if (event.type === 'proxy_completion') {
        const orgId = event.customer_id || "global";
        const deptId = event.project_id;
        const agentId = event.agent_id;
        const costUsd = event.cost_usd || 0;
        
        // 1. Record decision to scp_policy_log
        await env.DB.prepare(
          `
          INSERT OR IGNORE INTO scp_policy_log (event_id, request_id, scope, scope_id, action, rule_id, timestamp, cost_usd)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `
        )
          .bind(
            eventId || crypto.randomUUID(),
            event.request_id,
            "org",
            orgId,
            event.action,
            event.rule_id || null,
            event.timestamp || new Date().toISOString(),
            costUsd
          )
          .run();

        // 2. Update Org Budget (Default $50,000)
        await env.DB.prepare(
          `
          INSERT INTO scp_budget_ledger (scope, scope_id, period, spent_usd, budget_usd, warning_threshold_pct, block_threshold_pct)
          VALUES ('org', ?, ?, ?, 50000, 75, 100)
          ON CONFLICT(scope, scope_id, period) DO UPDATE SET spent_usd = spent_usd + ?
        `
        )
          .bind(orgId, period, costUsd, costUsd)
          .run();

        // 3. Update Dept Budget (Default $15,000) if present
        if (deptId) {
          await env.DB.prepare(
            `
            INSERT INTO scp_budget_ledger (scope, scope_id, period, spent_usd, budget_usd, warning_threshold_pct, block_threshold_pct)
            VALUES ('dept', ?, ?, ?, 15000, 75, 100)
            ON CONFLICT(scope, scope_id, period) DO UPDATE SET spent_usd = spent_usd + ?
          `
          )
            .bind(deptId, period, costUsd, costUsd)
            .run();
        }

        // 4. Update Agent Budget (Default $5,000) if present
        if (agentId) {
          await env.DB.prepare(
            `
            INSERT INTO scp_budget_ledger (scope, scope_id, period, spent_usd, budget_usd, warning_threshold_pct, block_threshold_pct)
            VALUES ('agent', ?, ?, ?, 5000, 75, 100)
            ON CONFLICT(scope, scope_id, period) DO UPDATE SET spent_usd = spent_usd + ?
          `
          )
            .bind(agentId, period, costUsd, costUsd)
            .run();
        }
      }

      message.ack();
    } catch (error) {
      console.error("Failed processing queue message:", error);
    }
  }
}
