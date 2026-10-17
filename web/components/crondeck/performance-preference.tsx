"use client";

import * as React from "react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

// Layout from MCP switch-card1; no form library is needed for a local preference.
export function PerformancePreference() {
  const [reduced, setReduced] = React.useState(false);
  React.useEffect(() => {
    setReduced(document.documentElement.dataset.effects === "reduced");
  }, []);
  return (
    <div className="flex flex-row items-center justify-between rounded-lg border p-4">
      <div className="space-y-0.5">
        <Label htmlFor="reduced-effects" className="text-base">Low power mode</Label>
        <p className="text-muted-foreground text-sm">Keep the spatial surfaces, disable blur and animation.</p>
      </div>
      <Switch id="reduced-effects" checked={reduced} onCheckedChange={(v) => {
        setReduced(v);
        document.documentElement.dataset.effects = v ? "reduced" : "balanced";
        localStorage.setItem("crondeck.effects", v ? "reduced" : "balanced");
      }} />
    </div>
  );
}
