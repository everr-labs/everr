// @vitest-environment node
import type { TraceConsultation } from "@everr/app/organizations/consultations";
import { organizationMilestoneDefinitions, type OrganizationMilestoneEvent } from "./events";
import { createAuthTestDatabase } from "@everr/app/identity/testing/database";
import { organization } from "@everr/app/db/schema";
import { createEventPublisher } from "@everr/app/server/events/publisher";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createOrganizationMilestoneStore, createTraceConsultations } from "./milestones";
import { createMilestoneTestTable } from "./testing/database";

vi.mock("@everr/app/db/client", () => ({ db: undefined }));
vi.mock("../app/env", () => ({ appEnv: { POLAR_PRO_PRODUCT_ID: "product_pro" } }));

describe.skipIf(!process.env.EVERR_IDENTITY_TEST_DATABASE_URL)(
  "Organization activation markers (actual PostgreSQL)",
  () => {
    let fixture: Awaited<ReturnType<typeof createAuthTestDatabase>>;
    const instant = new Date("2026-10-23T12:00:00.123Z");
    const evidence = (organizationId = "a"): TraceConsultation => ({
      principal: { kind: "client", clientId: "org-client", organizationId },
      surface: "mcp",
      traces: [
        {
          traceId: "trace",
          serviceName: "checkout",
          resourceAttributes: { "deployment.environment.name": "production" },
          spanAttributes: {},
        },
      ],
    });
    const read = () =>
      fixture.client.query("SELECT * FROM organization_milestones ORDER BY organization_id");
    function observer(
      publish: (fact: OrganizationMilestoneEvent) => Promise<void> = vi.fn(),
      now = () => instant,
    ) {
      const diagnostics = vi.fn();
      return {
        ...createTraceConsultations({
          store: createOrganizationMilestoneStore(fixture.database),
          events: { publish },
          now,
          diagnostics,
        }),
        publish,
        diagnostics,
      };
    }
    beforeAll(async () => {
      fixture = await createAuthTestDatabase(process.env.EVERR_IDENTITY_TEST_DATABASE_URL);
      await createMilestoneTestTable(fixture.client);
    });
    afterAll(async () => fixture?.client.close());
    beforeEach(async () => {
      await fixture.client.exec("TRUNCATE organization CASCADE");
      await fixture.database.insert(organization).values([
        {
          id: "a",
          name: "A",
          slug: "a",
          createdAt: new Date("2000-01-01Z"),
          metadata: '{"clickhouseReady":true}',
        },
        { id: "b", name: "B", slug: "b", createdAt: new Date("2000-01-01Z") },
      ]);
    });

    it("concurrent replicas commit one marker and publish each fact once after source commit", async () => {
      const facts: OrganizationMilestoneEvent[] = [];
      const committed: ReturnType<typeof read>[] = [];
      const publish = vi.fn(async (fact: OrganizationMilestoneEvent) => {
        facts.push(fact);
        committed.push(read());
      });
      const replicas = Array.from({ length: 3 }, () => observer(publish));
      for (let i = 0; i < 18; i++) replicas[i % 3].observe(evidence());
      await Promise.all(replicas.map((replica) => replica.stop()));
      for (const result of await Promise.all(committed)) expect(result.rows).toHaveLength(1);
      expect((await read()).rows).toMatchObject([
        {
          organization_id: "a",
          rule_version: 1,
          first_queryable_at: instant,
          activated_at: instant,
          surface: "mcp",
        },
      ]);
      expect(facts.map((fact) => fact.type)).toEqual([
        "telemetry.first_queryable",
        "organization.activated",
      ]);
      expect(replicas.flatMap((replica) => replica.diagnostics.mock.calls)).toEqual([]);
    });

    it("retains the achieved milestone across quiet periods and later valid consultations", async () => {
      const first = observer();
      first.observe(evidence());
      await first.stop();
      const later = observer(vi.fn(), () => new Date("2028-01-01T00:00:00Z"));
      later.observe(evidence());
      await later.stop();
      expect(later.publish).not.toHaveBeenCalled();
      expect((await read()).rows[0].activated_at).toEqual(instant);
    });

    it("keeps existing unobserved history unknown and isolates Organization scope", async () => {
      const state = observer();
      state.observe(evidence("a"));
      await state.stop();
      expect((await read()).rows).toMatchObject([
        {
          organization_id: "a",
          first_queryable_at: instant,
          activated_at: instant,
          rule_version: 1,
        },
      ]);
      expect((await read()).rows).toHaveLength(1);
    });

    it("preserves the successful action while an actual database lock prevents marker persistence", async () => {
      const blocker = await fixture.database.$client.connect();
      try {
        await blocker.query("BEGIN");
        await blocker.query("SELECT id FROM organization WHERE id = 'a' FOR UPDATE");
        const state = observer();
        const completedAction = () => {
          state.observe(evidence());
          return { rows: ["completed"] };
        };
        expect(completedAction()).toEqual({ rows: ["completed"] });
        await state.stop();
        expect(state.diagnostics).toHaveBeenCalledWith("storage");
        expect(state.publish).not.toHaveBeenCalled();
        expect((await read()).rows).toHaveLength(0);
      } finally {
        await blocker.query("ROLLBACK");
        blocker.release();
      }
      const later = observer(vi.fn(), () => new Date("2026-10-24T12:00:00Z"));
      later.observe(evidence());
      await later.stop();
      expect((await read()).rows[0].activated_at).toEqual(new Date("2026-10-24T12:00:00Z"));
    });

    it("retains stored markers after lost publication without replaying history", async () => {
      const publisherDiagnostics = vi.fn();
      const events = createEventPublisher({
        routes: organizationMilestoneDefinitions.map((definition) => ({
          definition,
          job: (event) => ({ task: "test/milestone", payload: event }),
        })),
        enqueue: async () => {
          throw new Error("enqueue unavailable");
        },
        diagnostics: publisherDiagnostics,
      });
      const state = observer(events.publish);
      state.observe(evidence());
      await state.stop();
      expect(publisherDiagnostics).toHaveBeenCalledTimes(2);
      expect((await read()).rows).toHaveLength(1);
      expect((await read()).rows[0]).toMatchObject({
        activated_at: instant,
        first_queryable_at: instant,
      });
      const later = observer();
      later.observe(evidence());
      await later.stop();
      expect(later.publish).not.toHaveBeenCalled();
    });

    it("retains completed-action authorization after a subsequent Membership departure and never creates missing Organizations", async () => {
      const state = observer();
      const historical = evidence();
      historical.principal = {
        kind: "member",
        userId: "departed",
        membershipId: "former",
        organizationId: "a",
      };
      // These are trusted completion facts, not browser claims. No later Membership is required.
      state.observe(historical);
      state.observe(evidence("deleted"));
      await state.stop();
      expect((await read()).rows).toHaveLength(1);
      expect(state.diagnostics).toHaveBeenCalledWith("storage");
      await fixture.client.exec("DELETE FROM organization WHERE id = 'a'");
      expect((await read()).rows).toHaveLength(0);
    });
  },
);
