"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { useUIPreferences } from "@/hooks/use-ui-preferences";
import { defaultPreferences, savePreferences, type UIPreferences } from "@/lib/ui-preferences";
import { dateTime } from "@/lib/format";

const choices = {
  clock: { title: "Clock format", description: "Used for times, chart labels and schedule descriptions.", options: [["24", "24-hour · 14:30"], ["12", "12-hour · 2:30 PM"]] },
  timezone: { title: "Display timezone", description: "Calendar and timestamps only. Job execution timezones stay unchanged.", options: [["local", "Browser local timezone"], ["UTC", "UTC"]] },
  timestamps: { title: "Timestamp style", description: "Choose ‘5 minutes ago’ or the exact date and time in lists.", options: [["relative", "Relative"], ["exact", "Exact date & time"]] },
  density: { title: "Interface density", description: "Compact mode reduces table row and card spacing.", options: [["comfortable", "Comfortable"], ["compact", "Compact"]] },
  weekStart: { title: "Calendar week starts on", description: "Reorders the month calendar’s columns.", options: [["sunday", "Sunday"], ["monday", "Monday"]] }
} as const;

export function UIPreferenceSettings() {
  const preferences = useUIPreferences();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Display & experience</CardTitle>
        <CardDescription>Saved automatically in this browser and synced across its open tabs.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {Object.entries(choices).map(([key, choice]) => (
          <div key={key} className="flex flex-col justify-between gap-3 rounded-lg border p-4 sm:flex-row sm:items-center">
            <div className="min-w-0 space-y-0.5">
              <Label htmlFor={`ui-${key}`} className="text-base">{choice.title}</Label>
              <p className="text-muted-foreground text-sm">{choice.description}</p>
            </div>
            <Select value={preferences[key as keyof typeof choices]} onValueChange={value => savePreferences({ [key]: value } as Partial<UIPreferences>)}>
              <SelectTrigger id={`ui-${key}`} className="w-full shrink-0 sm:w-48"><SelectValue /></SelectTrigger>
              <SelectContent>{choice.options.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        ))}
        <div className="flex flex-row items-center justify-between gap-4 rounded-lg border p-4">
          <div className="space-y-0.5">
            <Label htmlFor="ui-log-follow" className="text-base">Auto-follow live logs</Label>
            <p className="text-muted-foreground text-sm">Start each log viewer scrolled to its latest output.</p>
          </div>
          <Switch id="ui-log-follow" checked={preferences.logFollow} onCheckedChange={logFollow => savePreferences({logFollow})} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-muted-foreground text-xs" suppressHydrationWarning>Preview: {dateTime("2026-10-15T14:30:00Z")}</p>
          <Button variant="ghost" size="sm" onClick={() => savePreferences(defaultPreferences)}>Reset display preferences</Button>
        </div>
      </CardContent>
    </Card>
  );
}
