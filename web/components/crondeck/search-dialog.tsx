"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import useSWR from "swr";
import { toast } from "sonner";
import { ArrowUpRightIcon, PlayIcon, PlusIcon, MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { Command, CommandDialog, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { useSidebar } from "@/components/ui/sidebar";
import { navItems } from "@/components/layout/sidebar/nav-main";
import { JobTypeIcon } from "@/components/crondeck/job-type";
import { api, qs, type JobType } from "@/lib/api";

interface SearchJob { id: string; name: string; type: JobType; enabled: boolean }

export default function SearchDialog({open,onOpenChange}:{open:boolean;onOpenChange:(open:boolean)=>void}) {
  const [query,setQuery] = useState("");
  const [debounced,setDebounced] = useState("");
  const router = useRouter();
  const {setOpenMobile} = useSidebar();
  const {setTheme} = useTheme();
  const runMode = /^run\s/i.test(query);
  const term = (runMode ? query.replace(/^run\s+/i, "") : query).trim();
  useEffect(()=>{
    const timer=window.setTimeout(()=>setDebounced(term),150);
    return ()=>window.clearTimeout(timer);
  },[term]);
  const {data:jobs,error,isLoading,mutate} = useSWR<SearchJob[]>("/search/jobs"+qs({q:debounced}), {keepPreviousData:false,revalidateOnFocus:false});
  const pending = term!==debounced || isLoading;
  const match = (label:string) => label.toLowerCase().includes(query.trim().toLowerCase());
  const routes=navItems.flatMap(group=>group.items).filter(item=>match(item.title));
  const modes=([{value:"light",label:"Light",icon:SunIcon},{value:"dark",label:"Dark",icon:MoonIcon},{value:"system",label:"System",icon:MonitorIcon}] as const).filter(mode=>match(`${mode.label} theme`));
  const close = () => { onOpenChange(false);setOpenMobile(false); };
  const go = (path:string) => { close();router.push(path); };
  return <CommandDialog open={open} onOpenChange={onOpenChange} title="Search CronDeck" description="Find a job or page. Type run followed by a job name to execute it.">
    <Command shouldFilter={false}>
      <CommandInput value={query} onValueChange={setQuery} maxLength={128} placeholder="Find a job, page, or type ‘run …’" />
      <CommandList className="max-h-[min(24rem,60dvh)]" aria-busy={pending}>
        {!runMode && routes.length>0 && <CommandGroup heading="Go to">
          {routes.map(item=><CommandItem key={item.href} value={item.href} onSelect={()=>go(item.href)}>
            <item.icon /><span>{item.title}</span><ArrowUpRightIcon className="ms-auto opacity-35" />
          </CommandItem>)}
        </CommandGroup>}
        <CommandGroup heading={runMode ? "Run now" : "Jobs"}>
          {pending ? <p role="status" className="text-muted-foreground px-3 py-4 text-sm">Searching jobs…</p> :
            error ? <div role="status" className="px-3 py-4 text-sm"><p className="text-destructive">Could not search jobs.</p><Button size="sm" variant="outline" className="mt-2" onClick={()=>mutate()}>Retry search</Button></div> :
            jobs?.length ? jobs.map(job=><CommandItem key={job.id} value={job.id} onSelect={async()=>{
              if (!runMode) { go(`/jobs/view/?id=${job.id}`);return; }
              close();
              try { await api(`/jobs/${job.id}/run`,{method:"POST"});toast.success(`Started “${job.name}”`); }
              catch(e) { toast.error((e as Error).message); }
            }}>
              {runMode ? <PlayIcon /> : <JobTypeIcon type={job.type} className="size-7 rounded-lg [&_svg]:size-3.5" />}
              <span className="min-w-0 flex-1 truncate">{runMode ? `Run “${job.name}”` : job.name}</span>
              <span className="text-muted-foreground text-[11px]">{job.enabled ? job.type.toUpperCase() : "Paused"}</span>
            </CommandItem>) : <p role="status" className="text-muted-foreground px-3 py-4 text-sm">No matching jobs. Try a name, description or tag.</p>}
        </CommandGroup>
        {!runMode && (match("Create new job") || modes.length>0) && <CommandGroup heading="Quick actions">
          {match("Create new job") && <CommandItem value="create-job" onSelect={()=>go("/jobs/new/")}><PlusIcon /> Create new job</CommandItem>}
          {modes.map(mode=><CommandItem key={mode.value} value={`theme-${mode.value}`} onSelect={()=>{setTheme(mode.value);onOpenChange(false);}}>
              <mode.icon />{mode.label} theme
            </CommandItem>)}
        </CommandGroup>}
      </CommandList>
      <div className="text-muted-foreground flex flex-wrap justify-between gap-2 border-t px-3 py-2 text-[11px]">
        <span>↑ ↓ Navigate · Enter Select · Esc Close</span><span>Type <code className="text-foreground">run</code> + job name to execute</span>
      </div>
    </Command>
  </CommandDialog>;
}
