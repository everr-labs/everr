export function ObservabilityVision() {
  return (
    <section className="vision-story">
      <div className="vision-cost">
        <div className="vision-cost-heading">
          <h2>So why aren’t you monitoring yet?</h2>
          <p className="vision-answer">
            Because the tools are only part of the cost.
          </p>
          <p>
            The subscription is one cost. Learning what to collect, deciding
            what matters, and keeping the setup useful are others.
          </p>
        </div>
        <div className="vision-questions">
          <div>
            <h3>What should you instrument?</h3>
            <p>
              Which requests and dependencies need visibility? How much data is
              enough?
            </p>
          </div>
          <div>
            <h3>How do you get useful answers?</h3>
            <p>Building queries and dashboards takes time and knowledge.</p>
          </div>
          <div>
            <h3>What needs to stay up to date?</h3>
            <p>
              As your application changes, instrumentation, dashboards, and
              alert rules need attention.
            </p>
          </div>
        </div>
        <p className="vision-bridge">
          Those decisions take experience. Keeping them useful takes time. It’s
          understandable to put monitoring off when getting value looks like a
          project of its own.
        </p>
      </div>
      <div className="vision-solution">
        <div className="vision-solution-heading">
          <h2>
            You shouldn’t have to become an observability expert to get useful
            answers.
          </h2>
          <p>
            That’s why Everr exists: to make that experience part of the
            product.
          </p>
          <p>
            Everr condenses years of observability experience into an
            opinionated getting-started flow. Established practices guide the
            decisions you would otherwise have to research and maintain.
          </p>
        </div>
        <div className="vision-guides">
          <div>
            <h3>Instrument</h3>
            <p className="vision-guide-lead">
              AI-assisted setup, verified locally.
            </p>
            <p>
              Start with guidance on instrumentation and check that your
              telemetry arrives before you deploy.
            </p>
          </div>
          <div>
            <h3>Understand</h3>
            <p className="vision-guide-lead">Opinionated dashboards.</p>
            <p>
              Use established practices to explore your data and find the
              questions worth asking.
            </p>
          </div>
          <div>
            <h3>Act</h3>
            <p className="vision-guide-lead">
              Guided alerting. Informed investigation.
            </p>
            <p>
              Set up useful alerts and give your coding agent real-world context
              to investigate problems.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
