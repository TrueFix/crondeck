import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <div className="glass glass-sheen w-full max-w-md space-y-6 rounded-3xl border p-10 text-center">
        <div className="font-display text-aurora text-7xl tracking-tight">404</div>
        <div className="space-y-1">
          <h1 className="font-display text-2xl">Off schedule</h1>
          <p className="text-muted-foreground text-sm">
            This page never ran. Maybe it was disabled, or the link is wrong.
          </p>
        </div>
        <div className="flex justify-center gap-2">
          <Button asChild>
            <Link href="/">Go to overview</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/jobs/">View jobs</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
