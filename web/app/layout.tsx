import type { Metadata, Viewport } from "next";
import { ThemeProvider } from "next-themes";

import "./globals.css";

import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { GlassBackdrop } from "@/components/crondeck/backdrop";
import { SWRProvider } from "@/components/crondeck/swr-provider";

export const metadata: Metadata = {
  title: { default: "CronDeck", template: "%s · CronDeck" },
  description: "Self-hosted cron job manager",
  icons: { icon: "/icon.svg" }
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f4fb" },
    { media: "(prefers-color-scheme: dark)", color: "#14111f" }
  ]
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning className="font-sans">
      <body
        suppressHydrationWarning
        className="group/layout min-h-svh font-sans antialiased"
        data-theme-content-layout="full">
        <script dangerouslySetInnerHTML={{ __html: "try{document.documentElement.dataset.density=JSON.parse(localStorage.getItem('crondeck.ui')||'{}').density==='compact'?'compact':'comfortable'}catch(e){}" }} />
        <script dangerouslySetInnerHTML={{ __html: "try{document.documentElement.dataset.effects=localStorage.getItem('crondeck.effects')||(matchMedia('(prefers-reduced-motion: reduce)').matches?'reduced':'balanced')}catch(e){}" }} />
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
            <SWRProvider>
              <TooltipProvider>
                <GlassBackdrop />
                {children}
                <Toaster position="top-center" richColors />
              </TooltipProvider>
            </SWRProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
