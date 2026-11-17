---
name: t3code
description: use t3code.
---

# T3 Code

"t3code" means T3 Code, the app this agent runs in. When the user says it, do the thing through T3 Code's own tools, `mcp__t3-code__*`, not the shell or your provider's built-in tools. They load late: fetch them with ToolSearch before the first call.

## Thread or subagent

- A **thread** is top-level. It shows in the sidebar and the user works in it directly. Create one only when the user asks for a new thread.
- A **subagent** is a child that does one task and reports back to you. "Subagent", "delegate", and "parallel" always mean a subagent, never a new thread.

## Tools

| The user wants to | Tool |
| --- | --- |
| Start a new thread | `t3_thread_launch` |
| Start a subagent | `delegate_task` |
| Send a message to a thread | `t3_thread_send` |
| Find a thread | `t3_thread_list`, `t3_thread_search` |
| Read a thread or wait for it | `t3_thread_read`, `t3_thread_wait` |
| Stop a thread | `t3_thread_interrupt`, or `task_cancel` for a subagent |
| Move this thread into a worktree | `t3_worktree_handoff` |
| Fork this thread | `t3_thread_transfer` |
| Pin, snooze, settle, or archive a thread | `t3_thread_organize` |
| Run something on a schedule | `schedule_task` |
| Get a password or token from the user | `request_secret` |

Mention a thread to the user by the `link` the tool returned.
