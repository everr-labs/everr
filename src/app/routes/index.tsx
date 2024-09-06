import { createFileRoute } from "@tanstack/react-router";
import { trpc } from "../utils/trpc";
import { useState } from "react";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  const [counter, setCounter] = useState(0);
  const a = trpc.greeting.useQuery();

  return (
    <div className="p-2">
      <h3>
        {a.data?.msg}
        Welcome Home!
        <button
          onClick={() => {
            setCounter(counter + 1);
          }}
        >
          {counter}
        </button>
      </h3>
    </div>
  );
}
