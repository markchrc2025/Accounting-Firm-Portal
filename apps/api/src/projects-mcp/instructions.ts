// instructions.ts — PA3 (D67): what the Projects MCP server tells Claude, and the tools it has.
// The workflow follows Sentire Projects' instructions, in the Portal's words.

export const PROJECTS_MCP_TOOL_NAMES = [
  "list_projects",
  "get_project",
  "create_project",
  "update_project",
  "get_project_context",
  "search_issues",
  "get_issue",
  "create_issue",
  "create_issues",
  "update_issue",
  "add_comment",
  "post_status_update",
  "list_milestones",
  "save_milestone",
  "start_session",
  "end_session",
  "import_security_audit",
  "get_security_status",
] as const;

export const PROJECTS_MCP_INSTRUCTIONS = `Portal Projects tracks the status, milestones and issues of the firm's products and engagements (keys like PAY, BKS, POS).
Workflow for a coding session:
1. At the start, call start_session with the project key (read it from .sentire-projects.json in the repo if present), then get_project_context to see milestones, open issues and the last session's next steps.
2. While working, keep issues current: update_issue to move status (New, In progress, In review, Done), add_comment to log decisions or progress, create_issue for new bugs or follow-ups you discover. Pass the session_id from start_session to these calls so the changes are attributed to the session. Reference issue keys (PAY-12) in commit messages and pull request titles.
3. At the end, call end_session with a short summary of what was done and the next steps.
Security audits: after a run of the security-audit skill, call import_security_audit with findings.json, the run metadata and the coverage counts; confirmed findings become Bugs labelled security and sev-<severity>, leads that need validation become Tasks. A milestone cannot be closed while its project has open critical or high security issues. get_security_status shows the current state.
Rules: do not invent issue keys, look them up with search_issues. Prefer updating an existing issue over creating a duplicate. Keep comments short and factual. You act with the permissions of the person whose token you hold; if a call is refused, say so and ask them rather than working around it.`;
