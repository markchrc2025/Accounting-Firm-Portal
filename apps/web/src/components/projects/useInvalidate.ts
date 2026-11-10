// useInvalidate - after a change in a project, ask again for what the screens show of it (PB1).
import { useQueryClient } from "@tanstack/react-query";

export function useInvalidateProject(projectKey: string) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ["projects", "overview", projectKey] });
    void qc.invalidateQueries({ queryKey: ["projects", "issues", projectKey] });
    void qc.invalidateQueries({ queryKey: ["projects", "issue", projectKey] });
    void qc.invalidateQueries({ queryKey: ["projects", "milestones", projectKey] });
    void qc.invalidateQueries({ queryKey: ["projects", "activity", projectKey] });
    void qc.invalidateQueries({ queryKey: ["projects", "portfolio"] });
    // PB2: the board, the roadmap and My Work show the same issues and milestones
    void qc.invalidateQueries({ queryKey: ["projects", "board", projectKey] });
    void qc.invalidateQueries({ queryKey: ["projects", "roadmap", projectKey] });
    void qc.invalidateQueries({ queryKey: ["projects", "my-work"] });
  };
}
