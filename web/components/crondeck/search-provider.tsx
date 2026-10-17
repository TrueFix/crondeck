"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import SearchDialog from "./search-dialog";

const SearchContext = createContext<(() => void) | null>(null);

export function SearchProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const show = useCallback(() => setOpen(true), []);
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen(value => !value);
      }
    };
    document.addEventListener("keydown", down);
    return () => {
      document.removeEventListener("keydown", down);
    };
  }, []);
  return <SearchContext.Provider value={show}>
    {children}
    {open && <SearchDialog open={open} onOpenChange={setOpen} />}
  </SearchContext.Provider>;
}

export function useOpenSearch() {
  const open = useContext(SearchContext);
  if (!open) throw new Error("SearchProvider is required");
  return open;
}
