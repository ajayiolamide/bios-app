"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from "react";
import type { Organization } from "@/types/database";

interface OrgContextValue {
  organizations: Organization[];
  currentOrg: Organization | null;
  setCurrentOrg: (org: Organization) => void;
  addOrg: (org: Organization) => void;
  removeOrg: (orgId: string) => Organization | null; // returns next org to switch to, or null
  loading: false;
}

const OrgContext = createContext<OrgContextValue | null>(null);

interface OrgProviderProps {
  children: ReactNode;
  initialOrgs: Organization[];
}

export function OrgProvider({ children, initialOrgs }: OrgProviderProps) {
  const deduped = initialOrgs.filter(
    (org, idx, arr) => arr.findIndex((o) => o.id === org.id) === idx
  );
  const [organizations, setOrganizations] = useState<Organization[]>(deduped);

  // Always start with first org (matches server render), then sync from localStorage on mount
  const [currentOrg, setCurrentOrgState] = useState<Organization | null>(
    deduped[0] ?? null
  );

  useEffect(() => {
    const savedId = localStorage.getItem("bios_current_org_id");
    if (savedId) {
      const saved = deduped.find((o) => o.id === savedId);
      if (saved) setCurrentOrgState(saved);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setCurrentOrg(org: Organization) {
    setCurrentOrgState(org);
    localStorage.setItem("bios_current_org_id", org.id);
  }

  function addOrg(org: Organization) {
    setOrganizations((prev) => {
      if (prev.find((o) => o.id === org.id)) return prev;
      return [...prev, org];
    });
    setCurrentOrg(org);
  }

  function removeOrg(orgId: string): Organization | null {
    let next: Organization | null = null;
    setOrganizations((prev) => {
      const remaining = prev.filter((o) => o.id !== orgId);
      next = remaining[0] ?? null;
      return remaining;
    });
    if (currentOrg?.id === orgId) {
      if (next) setCurrentOrg(next);
      else {
        setCurrentOrgState(null);
        localStorage.removeItem("bios_current_org_id");
      }
    }
    return next;
  }

  return (
    <OrgContext.Provider
      value={{ organizations, currentOrg, setCurrentOrg, addOrg, removeOrg, loading: false }}
    >
      {children}
    </OrgContext.Provider>
  );
}

export function useOrg() {
  const ctx = useContext(OrgContext);
  if (!ctx) throw new Error("useOrg must be used within OrgProvider");
  return ctx;
}
