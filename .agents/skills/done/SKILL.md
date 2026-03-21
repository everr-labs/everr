---
name: done
description: Mark an idea, issue, or project as complete. Deletes its files from .specs/ and updates TASKS.md.
---

# Done Skill

Use this skill when the user wants to mark an item as complete. This deletes the item's files from `.specs/` and regenerates `TASKS.md`. **Irreversible — confirm before deleting.**

## Item Locations

- Projects: `.specs/projects/{name}/` (directory)
- Ideas: `.specs/ideas/{name}.md` (file)
- Issues: `.specs/issues/{name}.md` (file)

## Workflow

### Step 1: Identify the item

If the user named the item in the prompt, use it and infer the type from where it lives in `.specs/`. If the name is ambiguous or missing, read `TASKS.md` and list all open items, then ask:

> *"Which item are you marking as done?"*

### Step 2: Confirm

> *"Marking **{name}** ({type}) as done. This will permanently delete its files. Confirm?"*

Wait for explicit confirmation before proceeding.

### Step 3: Delete

Run the appropriate command:

- **Project**: `rm -rf .specs/projects/{name}/`
- **Idea**: `rm .specs/ideas/{name}.md`
- **Issue**: `rm .specs/issues/{name}.md`

### Step 4: Update TASKS.md

Run `bash scripts/update-tasks.sh` to regenerate `TASKS.md`.

### Step 5: Confirm completion

Show the updated TASKS.md and confirm the item is gone.

## Rules

1. Always confirm before deleting — this is irreversible
2. Identify item type from its location in `.specs/`, not from the name alone
3. Run `update-tasks.sh` after every deletion
4. If the item doesn't exist, say so and stop
