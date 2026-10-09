# Choose What to Observe

Use this guide when a setup request leaves observation coverage open. Ask about what the user wants to understand; choose the corresponding OTel signals and implementation yourself. Reuse answers already given, including an explicit request for a basic setup or to choose sensible defaults.

## Ground the choices in the repository

Briefly describe the runnable apps, their roles, existing telemetry, and relevant connections discovered during inspection. Recommend a useful starting scope, such as a frontend and its API, rather than presenting every workspace package as an equivalent target. Shared libraries normally contribute telemetry through their host runtime instead of owning another SDK or service identity.

If runtime scope is still unclear, ask which apps or flow to cover. Bundle this with the setup-mode choice when practical. A package selection alone leaves the coverage question open.

## Choose the setup mode

Offer these two options, explaining the proposed baseline for the actual runtimes before the user chooses:

- **Basic autopilot (recommended for a first setup):** The agent chooses and validates a small, useful baseline within the selected scope. Explain what it will capture and what questions that answers.
- **Targeted setup:** The user chooses the behavior or workflow they care about; the agent recommends how to observe it. A baseline plus a specific workflow is also a valid choice.

If the user already asked for a basic setup or delegated coverage, proceed with the baseline. Otherwise, wait for this choice before changing instrumentation. A recommended or preselected option is not an answer.

### Basic autopilot

Adapt the baseline to the runtime and existing instrumentation. Start from the following coverage where supported:

| Runtime | Baseline to propose |
| --- | --- |
| Backend or API | Request and dependency timing, captured errors, existing structured logs correlated with traces, and standard runtime or HTTP metrics available from the selected instrumentation. |
| Browser | Frontend errors, network timing, page-load performance, and web vitals. Join browser and server traces when both runtimes are in scope and support propagation. |
| Worker, CLI, or desktop process | Operation or job boundaries, failures, dependency timing, and existing structured logs; adapt to its actual lifecycle and available instrumentation. |

Use the runtime rules to select supported components and reuse working telemetry. Report omissions when the runtime cannot provide part of the baseline. Add custom spans only where needed to expose a basic operation boundary that existing instrumentation misses. Reserve domain events, custom business metrics, and broad user-interaction capture for selected observation goals. Runtime examples may show more signals than this plan requires; install and enable only the chosen coverage.

Once delegated, choose the technical details without asking the user to approve every signal or dependency. Ask again only if inspection reveals a decision that materially changes the agreed scope.

### Targeted setup

Offer a short menu of relevant goals using actual routes, jobs, integrations, or screens found in the code. Explain the proposed coverage in plain language. These are examples to adapt, not a checklist to enable in full:

| User's question | Coverage to recommend |
| --- | --- |
| Where do requests become slow? | Trace the selected routes and their database or external API calls, with correlated logs where available. |
| Why do requests or jobs fail? | Capture structured exceptions and failed operations, with enough trace context to locate the failing boundary. |
| Why is this background job slow or retrying? | Trace the job and its dependencies; record attempts and outcomes, and add duration or outcome metrics when aggregate trends are part of the goal. |
| Where does this user workflow fail or slow down? | Follow its selected frontend actions, network requests, and backend operations across the runtimes in scope. |
| Is a business operation succeeding over time? | Define the relevant outcome and emit bounded events or metrics for that operation. |

Let the user select multiple goals or describe another one. If a goal is broad, propose specific entry points or workflows from the repository and ask which matter first. If the goal is already specific, use it directly. Explain any required coverage in another runtime and resolve that scope before extending there.

Carry forward known exclusions and capture constraints. Ask about additional constraints only when they change the proposed collection; the skill's sensitive-data rules apply to every mode.

## Close the planning loop

Resolve missing environment or destination choices using Step 0, then show the per-service plan required by Step 1 before implementation. Choosing autopilot or answering the targeted questions settles coverage; both modes still include this visible plan.

For example, after discovering a web app, API, and worker, the opening can be:

> I found `apps/web` calling `apps/api`, plus an independent worker in `apps/worker`. I recommend starting with web and API to follow a request across both. Which apps should we cover, and would you prefer a basic autopilot setup or to choose specific flows? The baseline would cover frontend errors and page performance, API request and dependency timing, and correlated backend errors and logs.

If the user chooses targeted coverage, follow up with options drawn from the inspected code, such as a search route or an import job. If they choose the baseline, present the concrete plan and proceed. Replace all example names and capabilities with repository findings.
