import { useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchBirForm } from "../lib/api";
import { ErrorState, Skeleton } from "../components/ui";
import BirForm2551QEditor from "./BirForm2551QEditor";
import BirForm2550QEditor from "./BirForm2550QEditor";
import BirForm1701QEditor from "./BirForm1701QEditor";
import BirForm1701AEditor from "./BirForm1701AEditor";
import BirForm1701Editor from "./BirForm1701Editor";
import BirForm1702QEditor from "./BirForm1702QEditor";
import BirForm1702RTEditor from "./BirForm1702RTEditor";

/**
 * BIR form editor router. New forms take their code from `?form=` (default
 * 2551Q); existing forms are resolved by loading the saved record and reading
 * its `form`. Each concrete editor is self-contained and re-reads the form from
 * the React Query cache, so there's no double fetch.
 */
export default function BirFormEditorPage() {
  const { id } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  const isNew = !id;

  const existing = useQuery({
    queryKey: ["bir-form", id],
    queryFn: () => fetchBirForm(id!),
    enabled: !isNew,
  });

  const form = isNew ? params.get("form") ?? "2551Q" : existing.data?.form;

  if (!isNew && existing.isPending) {
    return (
      <div className="animate-fade-rise space-y-3">
        <Skeleton />
        <Skeleton className="w-2/3" />
      </div>
    );
  }
  if (!isNew && existing.isError) {
    return <ErrorState message="Could not load this form." onRetry={() => void existing.refetch()} />;
  }

  if (form === "2550Q") return <BirForm2550QEditor />;
  if (form === "1701Q") return <BirForm1701QEditor />;
  if (form === "1701A") return <BirForm1701AEditor />;
  if (form === "1701") return <BirForm1701Editor />;
  if (form === "1702Q") return <BirForm1702QEditor />;
  if (form === "1702RT") return <BirForm1702RTEditor />;
  return <BirForm2551QEditor />;
}
