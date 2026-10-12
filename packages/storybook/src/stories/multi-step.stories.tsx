import { Button } from "@everr/ui/components/button";
import { MultiStep, type MultiStepItem } from "@everr/ui/components/multi-step";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

const meta = {
  title: "Layout/MultiStep",
  component: MultiStep,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof MultiStep>;

export default meta;
type Story = StoryObj<typeof Example>;
type Step = "install" | "agent" | "local" | "production";

function Example({
  narrow = false,
  manual = false,
}: {
  narrow?: boolean;
  manual?: boolean;
}) {
  const [currentStep, setCurrentStep] = useState<Step>("agent");
  const steps: MultiStepItem<Step>[] = [
    {
      id: "install",
      title: "Install Everr",
      content: <p>Install the CLI in your terminal.</p>,
    },
    {
      id: "agent",
      title: "Connect your agent",
      skipped: manual ? "Manual setup" : undefined,
      content: (
        <>
          <p>
            From your project directory, install the bundled skills for your
            coding agent.
          </p>
          <pre className="whitespace-pre-wrap break-words rounded-md border p-4">
            everr skills install --all --project
          </pre>
          <Button onClick={() => setCurrentStep("local")}>
            Project skills installed
          </Button>
        </>
      ),
    },
    {
      id: "local",
      title: "Setup telemetry",
      content: (
        <>
          <pre className="whitespace-pre-wrap break-words rounded-md border p-4">
            /everr-setup-telemetry
          </pre>
          <Button onClick={() => setCurrentStep("production")}>
            I can see my local telemetry
          </Button>
        </>
      ),
    },
    {
      id: "production",
      title: "To production",
      content: (
        <p>
          Configure your production deployment using an ingestion key and the
          Cloud endpoint.
        </p>
      ),
    },
  ];
  return (
    <div
      className={
        narrow ? "mx-auto flex max-w-sm flex-col p-3" : "flex flex-col p-3"
      }
    >
      <MultiStep
        steps={steps}
        currentStep={currentStep}
        furthestStep="production"
        onStepChange={setCurrentStep}
        navigationLabel="Setup progress"
      >
        <div className="space-y-2 pt-4">
          <h1 className="text-3xl font-semibold">Set up your project</h1>
          <p>
            Each step uses the same width, heading, spacing, and navigation.
          </p>
        </div>
      </MultiStep>
    </div>
  );
}

export const Default: Story = { render: () => <Example /> };
export const Narrow: Story = { render: () => <Example narrow /> };
export const SkippedStep: Story = { render: () => <Example manual /> };
