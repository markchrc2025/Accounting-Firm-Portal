// ProjectsNav - the strip at the top of the Projects pages that are not one project (PB2): My Work,
// All projects, and the search box. The search is also offered inside a project (ProjectPage).

import { useEffect, useState, type FormEvent } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { cn } from "../ui";

/**
 * One search box over the issues and projects a person can see. Enter always goes to the results
 * page; when the text is exactly an issue key that exists, that page passes straight on to the
 * issue (the API says so with `jump`). Empty text goes there too and shows what the API says.
 */
export function ProjectsSearchBox({
  initial = "",
  className,
}: {
  initial?: string;
  className?: string;
}) {
  const navigate = useNavigate();
  const [text, setText] = useState(initial);
  useEffect(() => setText(initial), [initial]);
  function submit(e: FormEvent) {
    e.preventDefault();
    const q = text.trim();
    navigate(q ? `/projects/search?q=${encodeURIComponent(q)}` : "/projects/search");
  }
  return (
    <form role="search" onSubmit={submit} className={className}>
      <input
        type="search"
        aria-label="Search issues and projects"
        placeholder="Search, or type a key such as PAY-12"
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="input w-full min-w-[220px] sm:w-[300px]"
      />
    </form>
  );
}

export function ProjectsNav({ query }: { query?: string }) {
  const tab = ({ isActive }: { isActive: boolean }) =>
    cn(
      "-mb-px border-b-2 px-3.5 py-2 text-[13.5px] font-medium transition-colors",
      isActive
        ? "border-gold text-navy"
        : "border-transparent text-content-secondary hover:text-navy",
    );
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3 border-b border-line">
      <nav className="flex gap-1" aria-label="Projects">
        <NavLink to="/projects" end className={tab}>
          My Work
        </NavLink>
        <NavLink to="/projects/all" className={tab}>
          All projects
        </NavLink>
      </nav>
      <ProjectsSearchBox initial={query} className="pb-2" />
    </div>
  );
}
