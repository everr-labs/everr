import type { Pool } from "pg";
import { pool as defaultPool } from "@/db/client";

export interface WorkflowWithJobs {
  name: string;
  jobs: string[];
}

const LOOKBACK_SQL = "INTERVAL '90 days'";

type WorkflowJobRow = {
  workflowName: string;
  jobName: string;
};

export async function getWorkflowsList({
  pool = defaultPool,
  tenantId,
  repo,
  branch,
}: {
  pool?: Pool;
  tenantId: number;
  repo: string;
  branch?: string;
}): Promise<WorkflowWithJobs[]> {
  const clauses = [
    "wr.tenant_id = $1",
    "wr.repository = $2",
    `wr.last_event_at >= NOW() - ${LOOKBACK_SQL}`,
  ];
  const params: unknown[] = [tenantId, repo];

  if (branch) {
    params.push(branch);
    clauses.push(`wr.ref = $${params.length}`);
  }

  const whereClause = clauses.join(" AND ");

  const result = await pool.query<WorkflowJobRow>(
    `
      SELECT DISTINCT
        wr.workflow_name AS "workflowName",
        wj.job_name AS "jobName"
      FROM workflow_runs wr
      JOIN workflow_jobs wj
        ON wj.tenant_id = wr.tenant_id
        AND wj.trace_id = wr.trace_id
      WHERE ${whereClause}
      ORDER BY wr.workflow_name ASC, wj.job_name ASC
    `,
    params,
  );

  const workflowMap = new Map<string, string[]>();
  for (const row of result.rows) {
    const jobs = workflowMap.get(row.workflowName) ?? [];
    if (!jobs.includes(row.jobName)) {
      jobs.push(row.jobName);
    }
    workflowMap.set(row.workflowName, jobs);
  }

  return Array.from(workflowMap.entries()).map(([name, jobs]) => ({
    name,
    jobs,
  }));
}
