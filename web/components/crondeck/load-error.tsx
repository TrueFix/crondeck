"use client";
import { Button } from "@/components/ui/button";

export function LoadError({ onRetry }: { onRetry: () => void }) {
  return <div role="alert" className="glass space-y-3 rounded-2xl border p-6">
    <p>Could not load this data. Check your connection and try again.</p>
    <Button variant="outline" onClick={onRetry}>Retry</Button>
  </div>;
}
