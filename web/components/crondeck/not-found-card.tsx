import Link from "next/link";
import { SearchXIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Card } from "@/components/ui/card";

export function NotFoundCard({ what = "page" }: { what?: string }) {
  return (
    <Card className="mx-auto mt-10 max-w-lg">
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <SearchXIcon />
          </EmptyMedia>
          <EmptyTitle>That {what} doesn’t exist</EmptyTitle>
          <EmptyDescription>It may have been deleted, or the link is wrong.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button asChild>
            <Link href={what === "job" ? "/jobs/" : "/"}>{what === "job" ? "Back to jobs" : "Go home"}</Link>
          </Button>
        </EmptyContent>
      </Empty>
    </Card>
  );
}
