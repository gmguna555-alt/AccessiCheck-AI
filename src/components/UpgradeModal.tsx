import { X, Check, Zap, Crown, Loader2, LogIn } from 'lucide-react';
import { useState, useCallback } from 'react';
import { useAuth } from '@/lib/authContext';
import { AuthModal } from '@/components/AuthModal';
import { PRO_PRICE_INR, FREE_AUDIT_LIMIT } from '@/lib/subscription';

interface UpgradeModalProps {
  open: boolean;
  onClose: () => void;
}

export function UpgradeModal({ open, onClose }: UpgradeModalProps) {
  const { session, user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showAuthModal, setShowAuthModal] = useState(false);

  const handleCheckout = useCallback(async () => {
    setError('');

    if (!user || !session?.access_token) {
      setShowAuthModal(true);
      return;
    }

    setLoading(true);

    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ plan: 'pro_monthly' }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({ error: null }));
        const serverError = body?.error || '';

        if (response.status === 401) {
          setShowAuthModal(true);
        } else if (response.status === 400 && (serverError.includes('not configured') || serverError.includes('Payment is not configured'))) {
          setError('Payments are coming soon! We are setting up secure payment processing. Please check back shortly.');
        } else if (response.status === 400 && serverError.includes('already have an active')) {
          setError('You already have an active Pro subscription.');
        } else {
          setError(serverError || `Checkout failed (HTTP ${response.status}).`);
        }
        setLoading(false);
        return;
      }

      const data = await response.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        setError('Checkout session was not created. Please try again.');
      }
    } catch {
      setError('Unable to reach the payment service. Please try again later.');
    }
    setLoading(false);
  }, [user, session]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* Header gradient */}
        <div className="bg-gradient-to-r from-slate-900 via-blue-900 to-indigo-900 p-6 text-white relative">
          <button onClick={onClose} className="absolute top-4 right-4 text-white/70 hover:text-white transition">
            <X className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2 mb-1">
            <Crown className="w-5 h-5 text-amber-400" />
            <h2 className="text-xl font-bold">Upgrade to Pro</h2>
          </div>
          <p className="text-sm text-blue-200">Unlock unlimited accessibility audits</p>
        </div>

        <div className="p-6">
          {/* Feature comparison */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
            {/* Free plan */}
            <div className="border border-slate-200 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <Zap className="w-4 h-4 text-slate-400" />
                <span className="font-semibold text-slate-700 text-sm">Free</span>
              </div>
              <p className="text-2xl font-bold text-slate-800 mb-3">₹0<span className="text-sm font-normal text-slate-500">/mo</span></p>
              <ul className="space-y-1.5 text-xs text-slate-600">
                <li className="flex items-center gap-1.5"><Check className="w-3.5 h-3.5 text-green-500" /> {FREE_AUDIT_LIMIT} audits per month</li>
                <li className="flex items-center gap-1.5"><Check className="w-3.5 h-3.5 text-green-500" /> All 13 accessibility checks</li>
                <li className="flex items-center gap-1.5"><Check className="w-3.5 h-3.5 text-green-500" /> CSV, JSON, HTML reports</li>
                <li className="flex items-center gap-1.5"><Check className="w-3.5 h-3.5 text-green-500" /> AI explanations</li>
              </ul>
            </div>

            {/* Pro plan */}
            <div className="border-2 border-blue-500 rounded-xl p-4 bg-blue-50/30 relative">
              <div className="absolute -top-2.5 left-4 bg-blue-600 text-white text-xs font-semibold px-2 py-0.5 rounded-full">Recommended</div>
              <div className="flex items-center gap-2 mb-2">
                <Crown className="w-4 h-4 text-blue-600" />
                <span className="font-semibold text-blue-700 text-sm">Pro</span>
              </div>
              <p className="text-2xl font-bold text-slate-800 mb-3">₹{PRO_PRICE_INR}<span className="text-sm font-normal text-slate-500">/mo</span></p>
              <ul className="space-y-1.5 text-xs text-slate-700">
                <li className="flex items-center gap-1.5"><Check className="w-3.5 h-3.5 text-green-500" /> Unlimited audits</li>
                <li className="flex items-center gap-1.5"><Check className="w-3.5 h-3.5 text-green-500" /> All 13 accessibility checks</li>
                <li className="flex items-center gap-1.5"><Check className="w-3.5 h-3.5 text-green-500" /> CSV, JSON, HTML reports</li>
                <li className="flex items-center gap-1.5"><Check className="w-3.5 h-3.5 text-green-500" /> AI explanations</li>
                <li className="flex items-center gap-1.5"><Check className="w-3.5 h-3.5 text-green-500" /> Audit history</li>
                <li className="flex items-center gap-1.5"><Check className="w-3.5 h-3.5 text-green-500" /> Priority support</li>
              </ul>
            </div>
          </div>

          {error && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
              {error}
            </div>
          )}

          <button
            onClick={handleCheckout}
            disabled={loading}
            className="w-full py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Redirecting to checkout...</>
            ) : !user ? (
              <><LogIn className="w-4 h-4" /> Sign in to upgrade to Pro</>
            ) : (
              <><Crown className="w-4 h-4" /> Upgrade to Pro — ₹{PRO_PRICE_INR}/month</>
            )}
          </button>

          <p className="text-xs text-slate-400 text-center mt-3">
            Cancel anytime. Secure payment via Razorpay or Stripe.
          </p>

          <button
            onClick={onClose}
            className="w-full text-center text-sm text-slate-500 hover:text-slate-700 mt-3 transition"
          >
            Maybe later
          </button>
        </div>
      </div>

      <AuthModal open={showAuthModal} onClose={() => setShowAuthModal(false)} />
    </div>
  );
}
