// instructions.spec.ts — PA3 (D67): what the Projects MCP server tells Claude, and the tools it has.
import { PROJECTS_MCP_INSTRUCTIONS, PROJECTS_MCP_TOOL_NAMES } from "./instructions";

describe("PA3 · Projects MCP instructions and tool list", () => {
  it("the 16 tools of this unit, and no tool that deletes", () => {
    expect([...PROJECTS_MCP_TOOL_NAMES].sort()).toEqual(
      [
        "add_comment",
        "create_issue",
        "create_issues",
        "create_project",
        "end_session",
        "get_issue",
        "get_project",
        "get_project_context",
        "list_milestones",
        "list_projects",
        "post_status_update",
        "save_milestone",
        "search_issues",
        "start_session",
        "update_issue",
        "update_project",
      ].sort(),
    );
    expect(PROJECTS_MCP_TOOL_NAMES).toHaveLength(16);
    for (const n of PROJECTS_MCP_TOOL_NAMES)
      expect(n).not.toMatch(/delete|remove|destroy/);
    // the two security tools come with the audit tables, in the next unit
    expect(PROJECTS_MCP_TOOL_NAMES).not.toContain("import_security_audit");
    expect(PROJECTS_MCP_TOOL_NAMES).not.toContain("get_security_status");
  });

  it("the instructions tell Claude the session workflow and the rules", () => {
    const t = PROJECTS_MCP_INSTRUCTIONS;
    expect(t).toContain("start_session");
    expect(t).toContain("get_project_context");
    expect(t).toContain("update_issue");
    expect(t).toContain("add_comment");
    expect(t).toContain("create_issue");
    expect(t).toContain("end_session");
    expect(t).toContain(".sentire-projects.json");
    expect(t).toMatch(/do not invent issue keys/i);
    expect(t).toMatch(/search_issues/);
    expect(t).not.toMatch(/Sentire Projects tracks/); // it is the Portal's own words
    expect(t).not.toContain("—"); // no em dashes
    expect(t).not.toMatch(/security/i); // the security tools are not in this unit
  });
});
