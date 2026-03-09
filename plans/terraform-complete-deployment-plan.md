# Terraform Complete Deployment Plan

## Summary

The missing step to make `tofu apply` deploy the full stack is not AWS infrastructure creation itself. The missing step is the internal ClickHouse bootstrap and the runtime wiring that depends on it.

Today Terraform creates:

- the ClickHouse Cloud service
- Secrets Manager secrets for several ClickHouse users
- ECS services for the app and collector

But Terraform does not yet create or reconcile:

- ClickHouse databases inside the provisioned service
- ClickHouse users/grants/row policies inside the provisioned service
- ClickHouse tables and materialized views inside the provisioned service
- the app ECS runtime variables for the dedicated CDEvents writer

Because of that, `tofu apply` can finish while the deployed application is still not actually runnable end-to-end.

For the current implementation boundary, only part of that gap should move into Terraform now:

- Terraform should own ClickHouse databases, users, roles, and grants
- ClickHouse tables, materialized views, row policies, and other schema migrations can stay manual for now

## Goal

Make the deployment path complete enough that one Terraform-driven rollout creates all required ClickHouse identities and runtime wiring, while leaving schema creation and migrations as an explicit manual step for now.

## Non-Goals

- Replacing the existing AWS topology.
- Redesigning the app or collector runtime behavior.
- Changing unrelated Terraform module structure unless needed to support the missing deployment step.

## Current Gap

The repo currently documents a manual post-apply ClickHouse bootstrap in [infra/README.md](/Users/elfo404/projects/citric/infra/README.md). That manual process runs SQL from [clickhouse/init/00-setup.sh](/Users/elfo404/projects/citric/clickhouse/init/00-setup.sh), [clickhouse/init/03-create-otel-tables.sql](/Users/elfo404/projects/citric/clickhouse/init/03-create-otel-tables.sql), [clickhouse/init/10-create-mvs.sql](/Users/elfo404/projects/citric/clickhouse/init/10-create-mvs.sql), [clickhouse/init/20-apply-rls.sql](/Users/elfo404/projects/citric/clickhouse/init/20-apply-rls.sql), and [clickhouse/init/21-apply-cdevents-rls.sql](/Users/elfo404/projects/citric/clickhouse/init/21-apply-cdevents-rls.sql).

There is also a runtime contract mismatch:

- the app’s webhook/CDEvents runtime expects `CDEVENTS_CLICKHOUSE_URL`, `CDEVENTS_CLICKHOUSE_USERNAME`, `CDEVENTS_CLICKHOUSE_PASSWORD`, and `CDEVENTS_CLICKHOUSE_DATABASE`
- the Terraform ECS task definition currently injects only the generic ClickHouse read/write variables and does not expose the dedicated CDEvents writer variables

There is now a chosen ownership boundary:

- use the `ClickHouse/clickhouse` provider for ClickHouse Cloud service provisioning
- use the `ClickHouse/clickhousedbops` provider for internal ClickHouse databases, users, roles, and grants
- keep table creation, materialized views, row policies, and migrations manual for now

## Desired End State

After the work in this plan:

1. `tofu apply` provisions the AWS infrastructure and the ClickHouse Cloud service.
2. Terraform also manages the required ClickHouse internal databases, users, roles, and grants.
3. The app ECS task receives the correct read-only query credentials and the separate CDEvents writer credentials.
4. The collector ECS task receives the correct writer credentials for `otel`.
5. The infrastructure README clearly separates Terraform-managed identity/bootstrap from manual schema setup.

## Chosen Direction

Use a mixed model:

- `ClickHouse/clickhouse` continues to manage the ClickHouse Cloud service itself
- `ClickHouse/clickhousedbops` will manage internal ClickHouse databases, users, roles, and grants
- SQL-managed schema objects remain manual for now

Why this is the right boundary now:

- it removes the identity/bootstrap gap that blocks real deployments
- it avoids forcing tables, views, and row policies into Terraform before the provider boundary is mature enough
- it matches the current repo need: runtime principals must exist automatically, but schema evolution can still follow manual migrations

## Work Plan

### Phase 0: Discovery and Decision

#### Task 0.1: Inventory every ClickHouse object required for production

Deliverable:
- a written inventory mapped from `clickhouse/init/*` into object categories

Checklist:
- list required databases
- list required users
- list required roles
- list required grants
- list required row policies
- list required tables
- list required materialized views
- list any backfill statements that should not run automatically

Exit criteria:
- nothing in `clickhouse/init/` is still “implicit”

#### Task 0.2: Inventory every runtime credential consumer

Deliverable:
- a matrix of runtime consumers and required env vars

Checklist:
- map app read-query client variables
- map app CDEvents writer variables
- map collector writer variables
- map which secret each consumer should read

Exit criteria:
- no secret or env var is ambiguously owned

#### Task 0.3: Validate the `clickhousedbops` implementation boundary

Deliverable:
- a short note confirming exactly which objects Terraform will manage with `clickhousedbops`

Checklist:
- verify database support
- verify user support
- verify role support
- verify grant support
- verify how password rotation should behave
- explicitly mark row policies as manual
- explicitly mark tables and materialized views as manual

Exit criteria:
- the Terraform/manual boundary is documented with no ambiguity

### Phase 1: Normalize the Desired ClickHouse Contract

#### Task 1.1: Define the canonical user model

Target users:
- `collector_rw`
- `app_ro`
- `app_rw`

Checklist:
- keep `app_rw` as the dedicated app writer identity for now
- align Terraform names with runtime names
- align README wording with the final names

Exit criteria:
- one unambiguous name per real runtime identity

#### Task 1.2: Define the canonical database/object ownership model

Checklist:
- confirm which objects live in `otel`
- confirm which objects live in `app`
- confirm which roles are needed, if any
- confirm which objects are writable by collector
- confirm which objects are writable by app CDEvents writer
- confirm which objects are read-only for app query traffic

Exit criteria:
- grants can be expressed without guesswork

#### Task 1.3: Mark one-time backfill behavior

Checklist:
- identify which schema SQL remains manual
- identify any bootstrap SQL that is safe to rerun
- identify any backfill that must stay manual or separately gated
- document that initial schema creation is still outside Terraform scope

Exit criteria:
- manual schema work is clearly separated from Terraform-owned identity/bootstrap

### Phase 2: Refactor Terraform Inputs and Outputs

#### Task 2.1: Rename or replace misleading Terraform outputs/secrets

Problem:
- the module currently exposes `app_rw`, but the app service wiring still needs to use it as the dedicated CDEvents writer identity

Checklist:
- decide final secret names
- update module outputs
- preserve compatibility only if needed
- remove names that imply a broader permission set than intended

Exit criteria:
- secret naming matches actual runtime use

#### Task 2.1a: Add the `clickhousedbops` provider to the infra root

Checklist:
- add the provider requirement
- decide provider aliasing if both ClickHouse providers are used together
- define provider configuration inputs from existing ClickHouse service outputs and admin credentials

Exit criteria:
- Terraform can talk both to ClickHouse Cloud control plane and to the provisioned database service

#### Task 2.2: Extend the app service module interface

Checklist:
- add variables for CDEvents ClickHouse URL
- add variables for CDEvents ClickHouse username
- add secret input for CDEvents ClickHouse password
- keep existing read-only ClickHouse inputs separate

Exit criteria:
- the app ECS task can receive both read and write ClickHouse configs distinctly

#### Task 2.3: Update ECS task definition env/secrets wiring

Checklist:
- inject read-only app query config under the generic app query env names
- inject CDEvents writer config under `CDEVENTS_CLICKHOUSE_*`
- verify secret names line up with code in `packages/app/src/server/github-events/config.ts`

Exit criteria:
- deployed app no longer depends on local-default CDEvents credentials

#### Task 2.4: Validate collector module contract

Checklist:
- confirm collector still uses `collector_rw`
- confirm collector database remains `otel`
- confirm Terraform secret wiring matches collector expectations

Exit criteria:
- collector credentials remain least-privilege and explicit

### Phase 3: Codify ClickHouse Internal Bootstrap

#### Task 3.1: Create a single source of truth for Terraform-managed ClickHouse identities

Checklist:
- define Terraform resources for databases
- define Terraform resources for users
- define Terraform resources for roles if needed
- define Terraform resources for grants
- explicitly exclude tables, views, and row policies from this layer

Exit criteria:
- the Terraform-owned ClickHouse identity model is reviewable in one place

#### Task 3.2: Codify database creation

Checklist:
- manage `otel`
- manage `app`
- make creation idempotent

Exit criteria:
- both databases exist after deployment with no manual console work

#### Task 3.3: Codify user creation and password binding

Checklist:
- create `collector_rw`
- create `app_ro`
- create `app_rw`
- bind generated passwords to the correct ClickHouse users

Exit criteria:
- no generated password exists without a corresponding ClickHouse principal

#### Task 3.4: Codify roles if they help simplify grants

Checklist:
- decide whether direct grants are enough
- introduce roles only if they reduce duplication or clarify ownership
- avoid adding roles with no operational value

Exit criteria:
- the permission model is simple and justified

#### Task 3.5: Codify grants

Checklist:
- grant collector write privileges only where required
- grant app read privileges only where required
- grant CDEvents writer insert privileges only where required

Exit criteria:
- permissions are least-privilege and reproducible

#### Task 3.6: Document the manual schema boundary next to the Terraform-managed layer

Checklist:
- list which SQL files remain manual
- list the order they should be applied
- state which Terraform-created users are prerequisites for those scripts
- state that row policies remain manual
- add a TODO note in `infra/README.md` explaining that grants are temporarily applied at the database scope because tables are still created manually
- add a follow-up note in `infra/README.md` that the intended future state is Terraform-managed table creation followed by tighter grants applied to those Terraform-managed objects

Exit criteria:
- operators can clearly see where Terraform stops and manual schema starts

#### Task 3.7: Define dependency ordering

Checklist:
- service before database operations
- secrets/password generation before user creation if passwords are externalized first
- databases/users/grants before ECS rollout
- manual schema before app features that depend on those tables

Exit criteria:
- deployment order is deterministic

### Phase 4: Align Application Runtime With Terraform

#### Task 4.1: Reconcile app env naming

Checklist:
- confirm read query client uses generic `CLICKHOUSE_*`
- confirm CDEvents writer uses `CDEVENTS_CLICKHOUSE_*`
- confirm no code path still assumes `app_rw` by name
- confirm runtime naming and secret naming both resolve to `app_rw`

Exit criteria:
- runtime configuration is internally consistent

#### Task 4.2: Reconcile documentation and examples

Checklist:
- update `infra/README.md`
- add an explicit TODO section in `infra/README.md` for the current grant/schema gap
- update `infra/terraform.tfvars.example` if needed
- update any app deployment docs that mention manual bootstrap

Exit criteria:
- docs describe the real deployment path

#### Task 4.3: Decide migration strategy for existing environments

Checklist:
- define whether existing `app_rw` secrets can remain in place unchanged
- define whether existing environments require import/state moves
- define whether ClickHouse users must be renamed in place or recreated

Exit criteria:
- rollout steps are safe for already-provisioned stacks

### Phase 5: Verification

#### Task 5.1: Add Terraform validation coverage

Checklist:
- run `tofu fmt`
- run `tofu validate`
- run `tofu plan`

Exit criteria:
- Terraform changes are syntactically and graph-valid

#### Task 5.2: Add deployability verification

Checklist:
- verify app ECS task definition contains `CDEVENTS_CLICKHOUSE_*`
- verify secrets references resolve correctly
- verify ClickHouse databases, users, roles, and grants exist after apply
- verify manual schema prerequisites are clearly documented
- verify app can write CDEvents rows
- verify app read client can still query tenant-filtered tables
- verify collector can still insert telemetry rows

Exit criteria:
- the environment is operational immediately after deployment

#### Task 5.3: Add failure-mode checks

Checklist:
- verify deployment fails clearly if ClickHouse schema bootstrap fails
- verify deployment does not silently leave partial credentials/schema mismatch
- verify rerunning apply is idempotent

Exit criteria:
- deployment failure modes are actionable and repeatable

### Phase 6: Cleanup

#### Task 6.1: Remove stale manual bootstrap instructions

Checklist:
- remove only the manual instructions for databases/users/grants once obsolete
- keep manual schema/migration instructions for tables, views, and row policies
- keep a recovery/debugging section only if still useful

Exit criteria:
- docs reflect the new mixed deployment model

#### Task 6.2: Remove stale secret names and dead compatibility code

Checklist:
- remove old Terraform variables/outputs no longer used
- remove obsolete references only if new wiring makes any current names unused
- remove bootstrap assets that are no longer authoritative

Exit criteria:
- the repo has one deployment path, not two competing ones

## Suggested Execution Order

1. Finish Phase 0 and choose Option A or Option B.
2. Finish Phase 1 before editing Terraform modules.
3. Finish Phase 2 before attempting any schema automation.
4. Finish Phase 3 before rolling ECS changes to production-like environments.
5. Finish Phase 5 before removing any old docs or compatibility paths.
6. Finish Phase 6 last.

## Acceptance Criteria

This plan is complete when all of the following are true:

- a fresh environment can be deployed without manual ClickHouse user/database creation
- the app has separate read and CDEvents write credentials
- the collector has the correct write credentials
- required ClickHouse databases, users, roles, and grants are present after deployment
- deployment docs clearly distinguish Terraform-managed identity bootstrap from manual schema setup

## Open Questions

- Should one-time backfills remain manual even if schema creation becomes Terraform-managed?
- Should roles be used explicitly, or are direct grants enough for the current three-principal model?
