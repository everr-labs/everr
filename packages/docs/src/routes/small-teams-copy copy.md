# Small teams page copy

This document mirrors the user-facing text in `small-teams.tsx`. Section numbers follow the order of the rendered page.

---

## 00: Page metadata

> **PAGE METADATA**

### Title

Everr | Observability made easy

### Description

Understand performance, traffic spikes, and failures. Start monitoring locally for free, without an account, then take Everr to production with Hobby.

---

## 01: Hero

> **PAGE SECTION 01: HERO**

# Monitoring should be part of shipping.

## Not a project of its own.

Understand how your application performs, how it handles traffic spikes, and why requests fail. Everr turns established observability practices into a guided workflow, from AI-assisted setup to everyday monitoring and investigation.

### Actions

- Start monitoring your app (`#start-local`)
- See how Everr works (`#how-everr-works`)

---

## 02: Monitoring examples

> **PAGE SECTION 02: MONITORING EXAMPLES**

## An app can be up and still let users down.

Monitoring goes beyond error reporting. See where your app slows down, how it responds to demand, and what led to a failure.

### 01: How your application performs

A successful request can still be too slow. Follow its trace to see where time goes, from application code to database queries and external services.

#### Example UI

**Trace detail**  
Illustrative example

`GET /projects`  
200 OK, **2.10 s**

| Operation    | Timeline                | Duration |
| ------------ | ----------------------- | -------- |
| Request      | 0 s to 2.1 s            | 2.10 s   |
| Authenticate | At start                | 20 ms    |
| Database     | Nearly the full request | 2.04 s   |
| Response     | At end                  | 40 ms    |

**Insight:** The database accounts for 97% of request time.

### 02: How it handles traffic spikes

More traffic is only part of the picture. Read request volume alongside response times and error rates to see how your application behaves under load.

#### Example UI

**Traffic overview**  
Illustrative example

**Request rate** (req/s)  
10:00 - 10:15

- Chart scale: 0, 400, 800 req/s
- Chart times: 10:00, 10:07, 10:15
- P95 response time: 420 ms
- Response-time scale: 0 ms to 1,000 ms
- Error rate: 0.7%
- Error-rate scale: 0% to 10%

**Accessible chart description:** Request rate from 10:00 to 10:15, with two spikes reaching approximately 400 and 800 requests per second.

### 03: Why requests fail

An error message is a starting point. Read the stack trace and related logs in the context of the failed request to understand what happened and where to investigate.

#### Example UI

**Error detail**  
Illustrative example

**ERROR** `POST /checkout`  
10:12:08

**PaymentProviderError: upstream returned 503**

```text
at chargeCustomer (payments.ts:84)
at checkout       (checkout.ts:37)
```

**Related logs**  
`req_demo_42`

| Time     | Log                           |
| -------- | ----------------------------- |
| 10:12:07 | Payment request started       |
| 10:12:08 | Payment provider returned 503 |

---

## 03: OpenTelemetry foundations

> **PAGE SECTION 03: OPENTELEMETRY FOUNDATIONS**

**OpenTelemetry**

## The foundations are established.

## You don't have to reinvent them.

Monitoring has established practices, and OpenTelemetry provides a shared, vendor-neutral foundation for generating, collecting, and exporting traces, metrics, and logs.

The building blocks exist. Adopting them is where the work begins.

**So why aren't you monitoring yet?**

---

## 04: The cost beyond tools

> **PAGE SECTION 04: THE COST BEYOND TOOLS**

## Because the tools are only part of the cost.

The subscription is one cost. Learning what to collect, deciding what matters, and keeping the setup useful are others.

### 01: What should you instrument?

Which requests and dependencies need visibility? How much data is enough?

### 02: Rispondere a domande è costoso

Costruire query e dashboard richiede tempo e conoscenza

### 03: What needs to stay up to date?

As your application changes, which instrumentation, dashboards, and alert rules need attention?

Those decisions take experience. Keeping them useful takes time. It is understandable to put monitoring off when getting value from it looks like a project of its own.

**That's why Everr exists: to make that experience part of the product, so you don't have to figure everything out yourself.**

---

## 05: How Everr works

> **PAGE SECTION 05: HOW EVERR WORKS**

## You shouldn't have to become an observability expert to get useful answers.

Everr condenses years of observability experience into an opinionated getting-started flow. From AI-assisted instrumentation to dashboards and alerting, established practices guide the decisions that would otherwise be yours to research and maintain.

### 01: Instrument

- AI-assisted setup
- Local verification

### 02: Understand

- Opinionated dashboards

### 03: Act

- Guided alerting
- Real-world context for AI investigation

---

## 06: Start locally

> **PAGE SECTION 06: START LOCALLY**

## Start locally.

## Start for free.

Try Everr Local on your local environment. Collect and explore your telemetry on your machine, for free. No account required.

### Action

- Try Everr for free (`/docs/learn/install`)

### Badge

**Everr Local**  
Free. No account required.

### See it working before you deploy.

Let your coding assistant guide the instrumentation, run your app, and query the telemetry locally. Check what you are capturing, investigate real requests, and verify the setup before taking it to production.

### Take it to production with Hobby.

When you are ready, [create an account](https://app.everr.dev) and start monitoring in production with the Hobby plan's generous free allowance. Put monitoring to work before committing to a paid plan.

---

## 07: Closing

> **PAGE SECTION 07: CLOSING**

## Everr, observability made easy.
