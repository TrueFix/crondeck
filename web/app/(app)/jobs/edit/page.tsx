"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { ArrowLeftIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/crondeck/page-header";
import { JobForm, jobToInput } from "@/components/crondeck/job-form";
import { NotFoundCard } from "@/components/crondeck/not-found-card";
import type { JobDetail } from "@/lib/api";
import { LoadError } from "@/components/crondeck/load-error";

function EditJobInner() {
  const id = useSearchParams().get("id");
  const { data, error, mutate } = useSWR<JobDetail>(id ? `/jobs/${id}` : null, { revalidateOnFocus: false, keepPreviousData: false });

  if (!id || (error && (error as { status?: number }).status === 404)) {
    return <NotFoundCard what="job" />;
  }
  if (error && !data) return <LoadError onRetry={() => mutate()} />;

  return (
    <div className="space-y-4 lg:space-y-6">
      <PageHeader
        title={data ? `Edit · ${data.job.name}` : "Edit job"}
        description="Changes take effect immediately; the schedule is recalculated on save."
        actions={
          <Button variant="outline" asChild>
            <Link href={`/jobs/view/?id=${id}`}>
              <ArrowLeftIcon /> Back to job
            </Link>
          </Button>
        }
      />
      {data ? (
        <JobForm key={data.job.id} initial={jobToInput(data.job)} jobId={data.job.id} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-12">
          <Skeleton className="h-[600px] rounded-xl lg:col-span-8" />
          <Skeleton className="h-[500px] rounded-xl lg:col-span-4" />
        </div>
      )}
    </div>
  );
}

export default function EditJobPage() {
  return (
    <React.Suspense>
      <EditJobInner />
    </React.Suspense>
  );
}
