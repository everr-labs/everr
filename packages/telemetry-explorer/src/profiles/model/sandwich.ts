import {
  buildFlameTree,
  type FlameTree,
  frameKey,
  type ProfileFrame,
  type ProfileStack,
} from "./flame-tree";

export type FunctionRef = { name: string; file: string };

export type Sandwich = {
  /** Rooted at the function; each level down is one caller further out. */
  callers: FlameTree;
  /** Rooted at the function; each level down is one call deeper. */
  callees: FlameTree;
};

/**
 * The callers and callees of one function across every stack that runs it.
 * Both trees split at the function's outermost frame, so a recursive function
 * counts once per stack and its recursive calls show up among its callees,
 * and both roots weigh the function's total.
 */
export function buildSandwich(stacks: readonly ProfileStack[], fn: FunctionRef): Sandwich {
  const key = frameKey({ ...fn, line: 0 });
  const callerStacks: ProfileStack[] = [];
  const calleeStacks: ProfileStack[] = [];
  let line: number | undefined;
  for (const stack of stacks) {
    const index = stack.frames.findIndex((frame) => frameKey(frame) === key);
    if (index < 0) continue;
    const frameLine = stack.frames[index]?.line ?? 0;
    line = line === undefined || line === frameLine ? frameLine : 0;
    callerStacks.push({ frames: stack.frames.slice(0, index).reverse(), value: stack.value });
    calleeStacks.push({ frames: stack.frames.slice(index + 1), value: stack.value });
  }
  const root: ProfileFrame = { ...fn, line: line ?? 0 };
  return {
    callers: buildFlameTree(callerStacks, root),
    callees: buildFlameTree(calleeStacks, root),
  };
}
