import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';
import type { UserProfile, UsageInfo, AuditPermission } from '@/lib/subscription';

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  profile: UserProfile | null;
  usage: UsageInfo | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshUsage: () => Promise<void>;
  recordAudit: (target: string, method: 'url' | 'file') => Promise<AuditPermission>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [usage, setUsage] = useState<UsageInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = useCallback(async (userId: string) => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      console.error('Error fetching profile:', error.message);
      return null;
    }
    return data as UserProfile | null;
  }, []);

  const refreshUsage = useCallback(async () => {
    if (!session?.user) {
      setUsage(null);
      return;
    }
    const { data, error } = await supabase.rpc('get_user_usage');
    if (error) {
      console.error('Error fetching usage:', error.message);
      return;
    }
    setUsage(data as UsageInfo);
  }, [session]);

  const recordAudit = useCallback(async (target: string, method: 'url' | 'file'): Promise<AuditPermission> => {
    const { data, error } = await supabase.rpc('can_user_audit', {
      a_target: target,
      a_method: method,
    });
    if (error) {
      return { allowed: false, remaining: 0, plan: 'unknown', reason: error.message };
    }
    const result = data as AuditPermission;
    // Refresh usage after recording
    await refreshUsage();
    return result;
  }, [refreshUsage]);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(async ({ data: { session: initialSession } }) => {
      if (!mounted) return;
      setSession(initialSession);
      setUser(initialSession?.user ?? null);

      if (initialSession?.user) {
        const p = await fetchProfile(initialSession.user.id);
        if (mounted) setProfile(p);
      }
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
      (async () => {
        setSession(newSession);
        setUser(newSession?.user ?? null);

        if (newSession?.user) {
          const p = await fetchProfile(newSession.user.id);
          setProfile(p);
        } else {
          setProfile(null);
          setUsage(null);
        }
      })();
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [fetchProfile]);

  // Refresh usage when profile changes
  useEffect(() => {
    if (session?.user) {
      refreshUsage();
    }
  }, [session, profile, refreshUsage]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signUp({ email, password });
    return { error: error?.message ?? null };
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setProfile(null);
    setUsage(null);
  }, []);

  return (
    <AuthContext.Provider value={{ session, user, profile, usage, loading, signIn, signUp, signOut, refreshUsage, recordAudit }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
