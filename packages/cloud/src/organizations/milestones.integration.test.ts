// @vitest-environment node
import type {
  OrganizationMilestoneFact,
  UsefulConsultation,
} from "@everr/app/organizations/consultations";
import { organizationMilestoneDefinitions } from "@everr/app/organizations/consultations";
import { createAuthTestDatabase } from "@everr/app/identity/testing/database";
import { organization } from "@everr/app/db/schema";
import { createBusinessEventPublisher } from "@everr/app/server/business-events/publisher";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createCrmSnapshotReader } from "../crm/snapshots";
import { organizationSyncSubscribers } from "../crm/jobs";
import { createOrganizationMilestoneStore, createUsefulConsultations } from "./milestones";
import { createMilestoneTestTable } from "./testing/database";

vi.mock("@everr/app/db/client", () => ({ db: undefined }));
vi.mock("../app/env", () => ({ appEnv: { POLAR_PRO_PRODUCT_ID: "product_pro" } }));

describe.skipIf(!process.env.EVERR_IDENTITY_TEST_DATABASE_URL)(
  "Organization activation markers (actual PostgreSQL)",
  () => {
    let fixture: Awaited<ReturnType<typeof createAuthTestDatabase>>;
    const instant = new Date("2026-10-23T12:00:00.123Z");
    const evidence = (organizationId = "a"): UsefulConsultation => ({
      organizationId,
      principal: {
        kind: "client",
        clientId: "org-client",
        organizationId,
        authorization: "organization-query",
      },
      data: { organizationId, origin: "ci", provenance: "own-customer-telemetry" },
      trigger: "agent-request",
      completion: "succeeded",
      evidence: {
        kind: "query",
        surface: "mcp",
        purpose: "telemetry-analysis",
        matchedOwnRecords: 1,
      },
    });
    const read = () =>
      fixture.client.query("SELECT * FROM organization_milestones ORDER BY organization_id");
    function observer(
      publish: (fact: OrganizationMilestoneFact) => void = vi.fn(),
      now = () => instant,
    ) {
      const diagnostics = { log: vi.fn(), count: vi.fn() };
      return {
        ...createUsefulConsultations({
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
      await fixture.client
        .exec(`CREATE TABLE organization_billing (org_id text PRIMARY KEY REFERENCES organization(id) ON DELETE CASCADE, plan text NOT NULL DEFAULT 'hobby', polar_customer_id text);
CREATE TABLE org_subscription (org_id text PRIMARY KEY REFERENCES organization(id) ON DELETE CASCADE, polar_subscription_id text NOT NULL, polar_product_id text NOT NULL, status text NOT NULL, current_period_end timestamp, cancel_at_period_end boolean NOT NULL DEFAULT false, polar_modified_at timestamp NOT NULL, updated_at timestamp NOT NULL DEFAULT now());`);
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
      const facts: OrganizationMilestoneFact[] = [];
      const committed: ReturnType<typeof read>[] = [];
      const publish = vi.fn((fact: OrganizationMilestoneFact) => {
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
      expect(replicas.flatMap((replica) => replica.diagnostics.count.mock.calls)).toEqual([]);
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
      const reader = createCrmSnapshotReader(fixture.database, "test");
      expect(await reader.organization("a")).toMatchObject({
        fields: {
          firstQueryableAt: instant.toISOString(),
          activatedAt: instant.toISOString(),
          activationRuleVersion: 1,
          plan: "hobby",
          provisioning: "ready",
        },
      });
      expect(await reader.organization("b")).toMatchObject({
        fields: { firstQueryableAt: null, activatedAt: null, activationRuleVersion: null },
      });
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
        expect(state.diagnostics.count).toHaveBeenCalledWith("storage");
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

    it("repairs latest Company state from stored markers after lost publication without replaying history", async () => {
      const publisherDiagnostics = { log: vi.fn(), count: vi.fn() };
      const events = createBusinessEventPublisher({
        definitions: organizationMilestoneDefinitions,
        subscribers: organizationSyncSubscribers("paused", async () => {
          throw new Error("enqueue unavailable");
        }).filter((subscriber) =>
          organizationMilestoneDefinitions.some(
            (definition) => definition === subscriber.definition,
          ),
        ),
        diagnostics: publisherDiagnostics,
      });
      const state = observer(events.publish);
      state.observe(evidence());
      await state.stop();
      await events.stop();
      expect(publisherDiagnostics.count).toHaveBeenCalledTimes(2);
      expect((await read()).rows).toHaveLength(1);
      const reader = createCrmSnapshotReader(fixture.database, "test");
      const snapshot = await reader.organization("a");
      expect(snapshot).toMatchObject({
        fields: { activatedAt: instant.toISOString(), firstQueryableAt: instant.toISOString() },
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
        authorization: "current-membership",
      };
      // These are trusted completion facts, not browser claims. No later Membership is required.
      state.observe(historical);
      state.observe(evidence("deleted"));
      await state.stop();
      expect((await read()).rows).toHaveLength(1);
      expect(state.diagnostics.count).toHaveBeenCalledWith("storage");
      await fixture.client.exec("DELETE FROM organization WHERE id = 'a'");
      expect((await read()).rows).toHaveLength(0);
    });
  },
);
