// What the signed-in person may do in Projects, from the Portal's roles (PB1). The API still
// decides: every screen shows its sentence if it refuses something this hid or allowed.
import { useAuth } from "../../auth/AuthContext";
import { projectsCan, type ProjectsCan } from "../../lib/projects";

export function useProjectsCan(): ProjectsCan {
  const { user, hasPermission } = useAuth();
  return projectsCan(user, hasPermission);
}
