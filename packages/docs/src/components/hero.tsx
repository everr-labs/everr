import { Button } from "@everr/ui/components/button";
import { Link } from "@tanstack/react-router";

export function Hero() {
  return (
    <div className="asterisk-hero asterisk-editorial">
      <div className="asterisk-inner">
        <p className="hero-intro">Observability made simple.</p>
        <h1>
          Understand what your app is doing{" "}
          <span className="asterisk-promise">
            in minutes, not months<span className="asterisk-reference">*</span>
          </span>
        </h1>
        <div className="asterisk-under">
          <p className="asterisk-description">
            Everr turns established observability practices into guided
            workflows, from AI-assisted setup to everyday monitoring and
            investigation.
            <br />
            Focus shipping features, not hunting down issues.
          </p>
          <div className="asterisk-actions">
            <Button
              variant="default"
              size="xl"
              nativeButton={false}
              render={<Link to="/docs/$" params={{ _splat: "" }} />}
            >
              Get started
            </Button>
            <Button
              variant="secondary"
              size="xl"
              nativeButton={false}
              render={<Link to="/docs/$" params={{ _splat: "" }} />}
            >
              See how Everr works
            </Button>
          </div>
        </div>
        <div className="asterisk-body">
          <p className="asterisk-note">
            <span aria-hidden="true">*</span>No observability team required
          </p>
        </div>
      </div>
    </div>
  );
}
