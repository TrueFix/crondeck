"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/** Header icon control with a consistent pill surface (theme, notifications, etc.). */
export function IconToolbarButton({
  className,
  children,
  ...props
}: React.ComponentProps<typeof Button>) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className={cn(
        "size-9 rounded-xl border border-transparent bg-background/50 hover:border-border/60 hover:bg-muted/70",
        className
      )}
      {...props}>
      {children}
    </Button>
  );
}
