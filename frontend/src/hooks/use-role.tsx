import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { fetchMyRole, Role } from "@/src/api/client";
import { supabase } from "@/src/api/supabase";

interface RoleCtx {
  role: Role | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

const Ctx = createContext<RoleCtx>({ role: null, loading: true, refresh: async () => {} });

export function RoleProvider({ children }: { children: React.ReactNode }) {
  const [role, setRole] = useState<Role | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        setRole(null);
      } else {
        setRole(await fetchMyRole());
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      refresh();
    });
    return () => subscription.unsubscribe();
  }, [refresh]);

  return <Ctx.Provider value={{ role, loading, refresh }}>{children}</Ctx.Provider>;
}

export function useRole() {
  return useContext(Ctx);
}
