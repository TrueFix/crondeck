"use client";

import * as React from "react";
import Link from "next/link";
import useSWR from "swr";
import { ArrowRightIcon, CalendarClockIcon } from "lucide-react";

import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { PageHeader } from "@/components/crondeck/page-header";
import { JobTypeBadge, JobTypeIcon } from "@/components/crondeck/job-type";
import { templates } from "@/lib/templates";
import { describeCron } from "@/lib/format";
import type { Meta } from "@/lib/api";
import { useUIPreferences } from "@/hooks/use-ui-preferences";

const categories = ["All", "Monitoring", "Data", "Maintenance", "Integrations"] as const;

export default function TemplatesPage() {
  useUIPreferences();
  const [cat, setCat] = React.useState<(typeof categories)[number]>("All");
  const { data: meta } = useSWR<Meta>("/meta");
  const list = templates.filter((t) => cat === "All" || t.category === cat);

  return (
    <div className="space-y-4 lg:space-y-6">
      <PageHeader
        title="Templates"
        description="Ready-made jobs for common chores. Pick one, tweak it, save."
        actions={
          <Button variant="outline" asChild>
            <Link href="/jobs/new/">Start blank</Link>
          </Button>
        }
      />
      <ToggleGroup type="single" variant="outline" size="sm" value={cat} onValueChange={(v) => v && setCat(v as typeof cat)}>
        {categories.map((c) => (
          <ToggleGroupItem key={c} value={c} className="px-3">
            {c}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <div className="grid gap-4 sm:grid-cols-2 lg:gap-6 xl:grid-cols-3">
        {list.map((t) => {
          const blocked = meta && !meta.allow_shell && t.job.type !== "http";
          return (
            <Card key={t.id} className="lift group">
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <JobTypeIcon type={t.job.type} className="size-11 rounded-2xl [&_svg]:size-5" />
                  <Badge variant="secondary">{t.category}</Badge>
                </div>
                <CardTitle className="pt-2 text-base">{t.title}</CardTitle>
                <CardDescription>{t.description}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex items-center gap-2">
                  <JobTypeBadge type={t.job.type} />
                  <span className="text-muted-foreground flex items-center gap-1 font-mono text-xs">
                    <CalendarClockIcon className="size-3.5" />
                    {t.job.schedule}
                  </span>
                </div>
                <p className="text-muted-foreground text-xs">{describeCron(t.job.schedule)}</p>
              </CardContent>
              <CardFooter className="mt-auto">
                <Button className="w-full" variant={blocked ? "outline" : "default"} disabled={!!blocked} asChild={!blocked}>
                  {blocked ? (
                    <span>Shell jobs disabled</span>
                  ) : (
                    <Link href={`/jobs/new/?template=${t.id}`}>
                      Use template <ArrowRightIcon className="transition-transform group-hover:translate-x-0.5" />
                    </Link>
                  )}
                </Button>
              </CardFooter>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
