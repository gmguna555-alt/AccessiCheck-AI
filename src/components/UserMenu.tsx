import { useState, useRef, useEffect, useCallback } from 'react';
import { ChevronDown, User, LogOut, Crown, Zap } from 'lucide-react';
import { useAuth } from '@/lib/authContext';

interface UserMenuProps {
  onShowPricing: () => void;
}

export function UserMenu({ onShowPricing }: UserMenuProps) {
  const { user, profile, usage, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const handleSignOut = useCallback(async () => {
    await signOut();
    setOpen(false);
  }, [signOut]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (!user) return null;

  const isPro = profile?.plan === 'pro' && profile?.subscription_status === 'active';
  const remaining = usage?.remaining ?? 0;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 transition text-white text-sm"
      >
        {isPro ? (
          <Crown className="w-4 h-4 text-amber-400" />
        ) : (
          <Zap className="w-4 h-4 text-blue-300" />
        )}
        <span className="hidden sm:inline font-medium max-w-[120px] truncate">
          {user.email}
        </span>
        {!isPro && (
          <span className="text-xs bg-white/15 px-1.5 py-0.5 rounded-full">
            {remaining} left
          </span>
        )}
        {isPro && (
          <span className="text-xs bg-amber-400/20 text-amber-300 px-1.5 py-0.5 rounded-full">
            Pro
          </span>
        )}
        <ChevronDown className="w-3.5 h-3.5" />
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-64 bg-white rounded-xl shadow-xl border border-slate-200 overflow-hidden z-50">
          <div className="p-4 border-b border-slate-100">
            <p className="text-sm font-semibold text-slate-800 truncate">{user.email}</p>
            <p className="text-xs text-slate-500 mt-0.5">
              {isPro ? 'Pro Plan — Unlimited audits' : `Free Plan — ${remaining} of 10 audits remaining this month`}
            </p>
          </div>

          <div className="p-2">
            {!isPro && (
              <button
                onClick={() => { onShowPricing(); setOpen(false); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 rounded-lg transition"
              >
                <Crown className="w-4 h-4 text-amber-500" />
                Upgrade to Pro
              </button>
            )}
            <button
              onClick={() => { onShowPricing(); setOpen(false); }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 rounded-lg transition"
            >
              <User className="w-4 h-4 text-slate-400" />
              View Plans
            </button>
            <button
              onClick={handleSignOut}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg transition"
            >
              <LogOut className="w-4 h-4" />
              Sign Out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
