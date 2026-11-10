// IssueRows - a list of issues as My Work and the search show them (PB2): key, title, project,
// status, priority, assignee and due date (overdue said in words as well as colour).

import { Link } from "react-router-dom";
import { cn } from "../ui";
import { ColourChip, PriorityChip } from "./parts";
import { dayText, issuePath, type IssueItem } from "../../lib/projects";

export function DueText({ issue }: { issue: Pick<IssueItem, "dueDate" | "overdue"> }) {
  if (!issue.dueDate) return null;
  return (
    <span
      data-due={issue.dueDate}
      className={cn(
        "whitespace-nowrap font-mono text-[11px]",
        issue.overdue ? "font-semibold text-danger" : "text-content-secondary",
      )}
    >
      {issue.overdue ? "Overdue, due " : "Due "}
      {dayText(issue.dueDate)}
    </span>
  );
}

export function IssueRows({
  items,
  showAssignee = false,
}: {
  items: IssueItem[];
  showAssignee?: boolean;
}) {
  return (
    <ul className="divide-y divide-line">
      {items.map((i) => (
        <li
          key={i.id}
          data-issue={i.key}
          className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 text-[13px]"
        >
          <Link
            to={issuePath(i.project.key, i.key)}
            className="font-mono text-[12px] font-semibold text-blue underline-offset-2 hover:underline"
          >
            {i.key}
          </Link>
          <span className="min-w-[160px] flex-1 text-content">{i.title}</span>
          <span className="font-mono text-[11px] text-content-secondary">
            {i.project.name}
          </span>
          <ColourChip name={i.status.name} colour={i.status.colour} />
          <PriorityChip priority={i.priority} />
          {showAssignee ? (
            <span className="text-[12px] text-content-secondary">
              {i.assignee ? i.assignee.fullName : "Unassigned"}
            </span>
          ) : null}
          <DueText issue={i} />
        </li>
      ))}
    </ul>
  );
}
