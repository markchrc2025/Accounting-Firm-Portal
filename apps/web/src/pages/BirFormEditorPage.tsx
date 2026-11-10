import { useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchBirForm } from "../lib/api";
import { ErrorState, Skeleton } from "../components/ui";
import { FilingHistory } from "../components/birform/UndoFiling";
import { EditorWithPreview } from "../components/birform/PreviewPane";
import BirForm2551QEditor from "./BirForm2551QEditor";
import BirForm2550QEditor from "./BirForm2550QEditor";
import BirForm1701QEditor from "./BirForm1701QEditor";
import BirForm1701AEditor from "./BirForm1701AEditor";
import BirForm1701Editor from "./BirForm1701Editor";
import BirForm1702QEditor from "./BirForm1702QEditor";
import BirForm1702RTEditor from "./BirForm1702RTEditor";
import BirForm2307Editor from "./BirForm2307Editor";
import BirForm2316Editor from "./BirForm2316Editor";
import BirForm0619EEditor from "./BirForm0619EEditor";
import BirForm1601EQEditor from "./BirForm1601EQEditor";
import BirForm1601CEditor from "./BirForm1601CEditor";

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

  const form = isNew ? (params.get("form") ?? "2551Q") : existing.data?.form;

  if (!isNew && existing.isPending) {
    return (
      <div className="animate-fade-rise space-y-3">
        <Skeleton />
        <Skeleton className="w-2/3" />
      </div>
    );
  }
  if (!isNew && existing.isError) {
    return (
      <ErrorState
        message="Could not load this form."
        onRetry={() => void existing.refetch()}
      />
    );
  }

  // One editor instance (and one preview pane) per form, per new-form address, and per status (W3).
  // Without the key, React reuses the editor between /bir-forms/new and
  // /bir-forms/:id and between two ids, so one form's unsaved values carried
  // into another; and a form just marked filed kept unsaved edits on screen.
  // A new key mounts a fresh editor that hydrates from the server.
  const editorKey = isNew
    ? `new:${form}:${params.get("correctFrom") ?? ""}`
    : `${id}:${existing.data?.status ?? ""}`;
  return (
    <>
      <EditorWithPreview
        key={editorKey}
        editor={editorFor(form)}
        form={form}
        id={id}
        detail={existing.data}
      />
      {/* W22: the filings taken back stay on the return (every form, draft or filed). */}
      {existing.data ? <FilingHistory detail={existing.data} /> : null}
    </>
  );
}

function editorFor(form: string | undefined) {
  if (form === "2550Q") return <BirForm2550QEditor />;
  if (form === "1701Q") return <BirForm1701QEditor />;
  if (form === "1701A") return <BirForm1701AEditor />;
  if (form === "1701") return <BirForm1701Editor />;
  if (form === "1702Q") return <BirForm1702QEditor />;
  if (form === "1702RT") return <BirForm1702RTEditor />;
  if (form === "2307") return <BirForm2307Editor />;
  if (form === "2316") return <BirForm2316Editor />;
  if (form === "0619E") return <BirForm0619EEditor />;
  if (form === "1601EQ") return <BirForm1601EQEditor />;
  if (form === "1601C") return <BirForm1601CEditor />;
  if (form === "2551Q") return <BirForm2551QEditor />;
  // A code the web has no editor for is never opened as some other form (W17).
  return <ErrorState message={`The Portal has no editor for the form ${form}.`} />;
}
