import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";

const repoMainBranchesQueryKey = (repo: string) => [
  "repo",
  "mainBranches",
  repo,
];

async function fetchMainBranches(repo: string): Promise<string[]> {
  const res = await fetch(
    `/api/repos/main-branches?repo=${encodeURIComponent(repo)}`,
  );
  if (!res.ok) throw new Error("Failed to load main branches");
  const data = (await res.json()) as { branches: string[] };
  return data.branches;
}

async function putMainBranches(
  repo: string,
  branches: string[],
): Promise<void> {
  const res = await fetch(
    `/api/repos/main-branches?repo=${encodeURIComponent(repo)}`,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ branches }),
    },
  );
  if (!res.ok) throw new Error("Failed to save main branches");
}

export function RepoMainBranches({ repo }: { repo: string }) {
  const queryClient = useQueryClient();
  const [inputValue, setInputValue] = useState("");

  const { data: branches = [], isLoading } = useQuery({
    queryKey: repoMainBranchesQueryKey(repo),
    queryFn: () => fetchMainBranches(repo),
    enabled: !!repo,
  });

  const mutation = useMutation({
    mutationFn: (newBranches: string[]) => putMainBranches(repo, newBranches),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: repoMainBranchesQueryKey(repo),
      });
    },
  });

  function handleRemove(branch: string) {
    const updated = branches.filter((b) => b !== branch);
    mutation.mutate(updated);
  }

  function handleAdd() {
    const trimmed = inputValue.trim();
    if (!trimmed) return;
    if (branches.includes(trimmed)) {
      setInputValue("");
      return;
    }
    mutation.mutate([...branches, trimmed], {
      onSuccess: () => setInputValue(""),
    });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") handleAdd();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Main branches</CardTitle>
        <CardDescription>
          These branches are used for metrics filtering on this repo. Overrides
          org-wide defaults.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <p className="text-muted-foreground text-xs">Loading…</p>
        ) : (
          <ul className="space-y-1.5">
            {branches.map((branch) => (
              <li key={branch} className="flex items-center gap-2">
                <span className="text-muted-foreground select-none">●</span>
                <span className="text-sm flex-1">{branch}</span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={branches.length <= 1 || mutation.isPending}
                  onClick={() => handleRemove(branch)}
                  aria-label={`Remove ${branch}`}
                >
                  <X />
                </Button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex gap-2 pt-1">
          <Input
            placeholder="branch name"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={mutation.isPending}
            className="max-w-56"
          />
          <Button
            variant="outline"
            onClick={handleAdd}
            disabled={!inputValue.trim() || mutation.isPending}
          >
            Add
          </Button>
        </div>

        {mutation.isError ? (
          <p className="text-destructive text-xs">
            Failed to save. Please try again.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
