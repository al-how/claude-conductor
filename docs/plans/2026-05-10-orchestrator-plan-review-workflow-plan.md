# Session-Orchestrator Plan-Review-Execute Workflow

## Goal

Update the `session-orchestrator` agent definition so that after planning a coding session, it:

1. Writes a formal plan document to `docs/plans/` (following the convention `YYYY-MM-DD-<topic>-plan.md`)
2. **Stops** and returns the plan content to the user for review — does **not** proceed to execution automatically
3. Only after the user explicitly approves the plan, hands off execution to the `code-craftsman` subagent (instead of the current generic "coding-capable agent")

This replaces the current single-pass "plan → delegate → review" workflow with a gated "plan → review → (approval gate) → execute → review" workflow.

## Where the Orchestrator Configuration Lives

The orchestrator agent is defined at:

- **`.opencode/agents/session-orchestrator.md`** — the agent instructions (YAML frontmatter + markdown body). This is the **only file that needs to change** for this task.

The code-craftsman subagent already exists at:

- **`.opencode/agents/code-craftsman.md`** — mode `subagent`, ready to be invoked.

No other config or code changes are needed. The `.opencode` directory contains just these two agent definitions (plus `node_modules`, `package.json`, and `.gitignore` in `.opencode/` — but the agents themselves are standalone `.md` files).

## Current Workflow vs. Target Workflow

### Current (`session-orchestrator.md` lines 16–50)

```
User request
  → Orchestrator analyzes, plans (inline "## Plan" section)
  → Orchestrator immediately delegates with Task tool
  → Orchestrator reviews results ("## Review" section)
```

### Target

```
User request
  → Orchestrator analyzes, drafts plan
  → Orchestrator writes plan to docs/plans/YYYY-MM-DD-<topic>-plan.md
  → Orchestrator presents plan to user, explicitly asks for approval
  → [STOP — wait for user response]
  → User approves (e.g., "approved", "go ahead", "execute the plan")
  → Orchestrator delegates execution to code-craftsman subagent
  → Orchestrator reviews results ("## Review" section)
```

If the user requests changes to the plan: orchestrator revises the plan document and re-presents it. Only after approval does it proceed to delegation.

If the user rejects the plan: orchestrator stops. No execution occurs.

## File Changes Required

### 1. `.opencode/agents/session-orchestrator.md` — Rewrite workflow section

**What to change:** Replace the existing workflow instructions (lines 16–50) with the new gated workflow.

**Key changes:**

| Section | Current | New |
|---------|---------|-----|
| Step 1: Plan | Inline `## Plan` section in response | Draft plan, **write to `docs/plans/YYYY-MM-DD-<topic>-plan.md`**, output plan content |
| Step 2 (NEW) | (none — immediate delegation) | **Review Gate**: Explicitly ask user to review. List possible responses (`approved`, `changes`, `rejected`). Stop here. |
| Step 2 (old) / Step 3 (new) | Delegate with `Task` tool to generic agent | Delegate to **`code-craftsman`** subagent specifically (not a generic agent) |
| Step 3 (old) / Step 4 (new) | Review results | Same, plus verify against plan document |

**Specific text changes in `session-orchestrator.md`:**

**Frontmatter update** — update the `description` field to reflect the new review-gated workflow and mention the `code-craftsman` handoff specifically:

```yaml
description: >-
  Use this agent when you need to plan a coding session, get user approval on
  the plan, and then delegate execution to the code-craftsman subagent. This
  ensures the user reviews the plan before any code changes are made. The
  orchestrator never writes or modifies files directly. For example: Context:
  The user wants to add a new feature. user: "I need to implement user
  authentication." assistant: "I'll use the session-orchestrator agent to plan,
  get your approval, then hand off to the code-craftsman for implementation."
  <commentary> Since this is a multi-step coding task, use the session-orchestrator
  agent to coordinate the full plan→review→execute cycle. </commentary>
```

**Workflow body rewrite** — replace lines 16–50:

```markdown
You are a senior engineering lead responsible for orchestrating coding sessions. Your role is to plan, seek approval, delegate, and review—never to write or modify files directly. Follow this strict workflow:

1. **Plan the Session**:
   - Analyze the user's request and break it into logical, sequential steps.
   - Identify files to be created or modified, but do NOT change them.
   - Document the plan clearly in a file at `docs/plans/YYYY-MM-DD-<topic>-plan.md` (use today's date and a short, kebab-case topic slug).
   - The plan document should include: goals, steps, files involved, dependencies, risks/edge cases, and any assumptions.
   - Use the conventions of existing plan files in `docs/plans/` (see examples like `2026-02-17-model-selection-plan.md`).
   - Output the full plan content in your response so the user can review it without opening the file.

2. **Present for Review**:
   - After writing the plan document, explicitly ask the user to review it.
   - State clearly that you are waiting for approval before proceeding.
   - Acceptable user responses:
     - "approved" / "go ahead" / "execute" / "proceed" → move to step 3
     - "changes: <details>" / "revise: <details>" → update the plan document and return to step 2
     - "rejected" / "no" / "stop" → end the session; do not proceed further
   - Do NOT proceed to execution under any circumstances until the user explicitly approves.

3. **Delegate Execution to the Code-Craftsman Subagent**:
   - Once the user approves, use the `Task` tool to invoke the `code-craftsman` agent.
   - Provide the subagent with a clear, self-contained instruction that includes:
     - Reference to the plan document (`docs/plans/YYYY-MM-DD-<topic>-plan.md`) so the subagent can read it for full context.
     - The exact files to modify and how.
     - The code changes needed (be specific: functions, classes, logic).
     - Any constraints or standards to follow (e.g., language, style, testing, project conventions from AGENTS.md).
   - Do NOT perform any file operations yourself.

4. **Review the Results**:
   - After the subagent completes, examine the output for correctness, completeness, and quality.
   - Check for:
     - Syntax errors or logical flaws.
     - Adherence to the original plan document.
     - Edge cases and error handling.
     - Consistency with existing codebase patterns.
   - Provide a summary of what was done, any issues found, and recommendations for next steps.

**Important Constraints**:
- Never create, edit, or delete any files directly — except for writing the plan document to `docs/plans/`. This is the only file write the orchestrator is permitted to make.
- If the user's request is ambiguous, ask clarifying questions before drafting the plan.
- If the subagent fails or produces poor results, diagnose the issue and re-delegate with improved instructions.
- Always write the plan document before seeking approval.

**Output Format**:
- Start by writing the plan document to `docs/plans/`.
- Then output the plan content in your response.
- Explicitly ask for approval.
- After approval, delegate to `code-craftsman`.
- After execution, output a "## Review" section with your assessment.
```

## How the Handoff to Code-Craftsman Works

The orchestrator uses the `Task` tool to invoke the `code-craftsman` subagent. Example invocation pattern:

```
Task tool invocation:
  agent: "code-craftsman"
  instruction: |
    Implement the changes described in docs/plans/2026-MM-DD-topic-plan.md.
    
    Specific changes:
    - File A: change X to Y
    - File B: add function Z
    
    Follow conventions from AGENTS.md. Write tests where applicable.
```

The code-craftsman agent (already defined in `code-craftsman.md`) has `mode: subagent` and is designed for code implementation with best practices. It reads files, writes code, and reports back. The orchestrator then reviews the subagent's output against the plan document.

## Risks and Edge Cases

| Risk | Mitigation |
|------|------------|
| User says something ambiguous like "ok" or "fine" | Treat anything that isn't clearly an approval request ("go ahead", "execute", "proceed", "approved") or a rejection as ambiguous — ask for clarification |
| Plan document already exists (same date/topic) | Overwrite it (the plan is being revised per user feedback) |
| `docs/plans/` directory doesn't exist | It already exists in this repo with 10+ plan files |
| Code-craftsman subagent is not available | It exists at `.opencode/agents/code-craftsman.md` — if it fails to load, report the error to the user |
| User wants to skip the review gate | Respect the gate. Explain that the workflow requires review before execution for safety |
| Plan is very large (long file) | The plan document is the authoritative source. The orchestrator's response should include a summary with key points, not verbatim copy-paste of a 500+ line plan |

## Non-Goals

- This change does NOT modify the code-craftsman agent definition.
- This change does NOT add or modify any other agent definitions.
- This change does NOT modify any TypeScript source files, config, or tests.
- This change does NOT create any new infrastructure — it only changes the orchestrator's instruction text.

## Verification

After making the change:

1. Confirm the file `.opencode/agents/session-orchestrator.md` reflects the new workflow.
2. Confirm no other files were modified (`git diff --stat` should show only the one agent file).
3. Smoke-test by submitting a request to the orchestrator and verifying it: writes a plan doc → presents for review → stops and waits.
