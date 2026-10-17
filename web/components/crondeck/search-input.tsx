"use client";

import { useEffect, useRef, useState } from "react";
import { SearchIcon, XIcon } from "lucide-react";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";

/** Keep keystrokes local: typing must not re-render an entire table and its row menus. */
export function SearchInput({value,onChange}:{value:string;onChange:(value:string)=>void}) {
  const [draft,setDraft]=useState(value);
  const committed=useRef(value);
  useEffect(()=>{
    if(value!==committed.current){committed.current=value;setDraft(value);}
  },[value]);
  useEffect(()=>{
    if(draft===committed.current)return;
    const timer=window.setTimeout(()=>{committed.current=draft;onChange(draft);},150);
    return()=>window.clearTimeout(timer);
  },[draft,onChange]);
  return <InputGroup className="w-full max-w-64 shrink-0">
    <InputGroupInput aria-label="Search jobs" placeholder="Search jobs, descriptions, tags…" value={draft} onChange={e=>setDraft(e.target.value)} />
    <InputGroupAddon><SearchIcon /></InputGroupAddon>
    {draft && <InputGroupAddon align="inline-end">
      {draft!==value && <Spinner className="size-3.5" />}
      <Button type="button" variant="ghost" size="icon-sm" aria-label="Clear search" onClick={()=>{committed.current="";setDraft("");onChange("");}}><XIcon className="size-3.5" /></Button>
    </InputGroupAddon>}
  </InputGroup>;
}
