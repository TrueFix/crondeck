"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { LayoutTemplateIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/crondeck/page-header";
import { JobForm, emptyJob } from "@/components/crondeck/job-form";
import { getTemplate } from "@/lib/templates";
import type { JobInput, Meta } from "@/lib/api";

function NewJobInner() {
  const params = useSearchParams();
  const templateId = params.get("template");
  const { data: meta, error } = useSWR<Meta>("/meta");

  const initial = React.useMemo<JobInput | null>(() => {
    if (!meta && !error) return null;
    const base = emptyJob(meta?.default_timezone ?? "UTC");
    const t = getTemplate(templateId);
    if (!t) return base;
    return { ...base, ...t.job, config: structuredClone(t.job.config), tags: [...(t.job.tags ?? [])] };
  }, [meta, error, templateId]);

  const tpl = getTemplate(templateId);

  return (
    <div className="space-y-4 lg:space-y-6">
      <PageHeader
        title={tpl ? `New job · ${tpl.title}` : "New job"}
        description={tpl ? tpl.description : "Configure what runs, when it runs, and how failures are handled."}
        actions={
          <Button variant="outline" asChild>
            <Link href="/templates/">
              <LayoutTemplateIcon /> Start from a template
            </Link>
          </Button>
        }
      />
      {initial ? (
        <JobForm key={templateId ?? "blank"} initial={initial} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-12">
          <Skeleton className="h-[600px] rounded-xl lg:col-span-8" />
          <Skeleton className="h-[500px] rounded-xl lg:col-span-4" />
        </div>
      )}
    </div>
  );
}

export default function NewJobPage() {
  return (
    <React.Suspense>
      <NewJobInner />
    </React.Suspense>
  );
}
