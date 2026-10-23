import { useState, useCallback, useRef } from 'react';
import {
  ShieldCheck,
  Globe,
  Upload,
  FileCode,
  Download,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  AlertCircle,
  Info,
  CheckCircle2,
  XCircle,
  Loader2,
  Eye,
  Lightbulb,
  FileText,
  Zap,
  ExternalLink,
  Trash2,
  Sparkles,
  LogIn,
  Check,
  Crown,
  Lock,
} from 'lucide-react';
import type { AuditResult, Finding, Severity } from '@/lib/types';
import { runAudit } from '@/lib/audit';
import { validateUrl, SECURITY_LIMITS } from '@/lib/security';
import { generateCSV, generateJSON, generateHTMLReport, downloadFile, generateReportFilename } from '@/lib/reportGenerator';
import { explainFindings, AI_DISCLAIMER } from '@/lib/aiExplainer';
import { useAuth } from '@/lib/authContext';
import { FREE_AUDIT_LIMIT, PRO_PRICE_INR } from '@/lib/subscription';
import { AuthModal } from '@/components/AuthModal';
import { UpgradeModal } from '@/components/UpgradeModal';
import { UserMenu } from '@/components/UserMenu';

type Tab = 'dashboard' | 'findings' | 'explanations' | 'export';
type AuditState = 'idle' | 'auditing' | 'done' | 'error';

const severityConfig: Record<Severity, { label: string; color: string; bg: string; border: string; text: string; icon: typeof AlertTriangle }> = {
  critical: { label: 'Critical', color: 'red', bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700', icon: AlertTriangle },
  serious: { label: 'Serious', color: 'orange', bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-700', icon: AlertCircle },
  moderate: { label: 'Moderate', color: 'amber', bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700', icon: Info },
  minor: { label: 'Minor', color: 'blue', bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700', icon: Info },
};

function App() {
  const { user, profile, usage, recordAudit } = useAuth();
  const [url, setUrl] = useState('');
  const [auditState, setAuditState] = useState<AuditState>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [result, setResult] = useState<AuditResult | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  const [expandedFindings, setExpandedFindings] = useState<Set<string>>(new Set());
  const [progressMsg, setProgressMsg] = useState('');
  const [progressStage, setProgressStage] = useState<'validating' | 'fetching' | 'analyzing' | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [showPricing, setShowPricing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isPro = profile?.plan === 'pro' && profile?.subscription_status === 'active';
  const remaining = usage?.remaining ?? 0;
  const limitReached = !isPro && remaining === 0;

  const toggleFinding = useCallback((id: string) => {
    setExpandedFindings(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const performAudit = useCallback((htmlContent: string, target: string, method: string) => {
    setAuditState('auditing');
    setProgressStage('analyzing');
    setProgressMsg('Analyzing HTML and running accessibility checks...');

    setTimeout(() => {
      try {
        const auditResult = runAudit(htmlContent, target, method);
        setResult(auditResult);
        setAuditState('done');
        setActiveTab('dashboard');
        setProgressStage(null);
      } catch (err) {
        setErrorMsg('Failed to analyze the page: ' + (err instanceof Error ? err.message : 'Unknown error'));
        setAuditState('error');
        setProgressStage(null);
      }
    }, 50);
  }, []);

  // Gate: require auth + check limits before starting audit
  const checkAuditPermission = useCallback(async (target: string, method: 'url' | 'file'): Promise<boolean> => {
    if (!user) {
      setShowAuthModal(true);
      return false;
    }

    if (limitReached) {
      setShowUpgradeModal(true);
      return false;
    }

    // Atomic server-side check + increment via RPC
    const permission = await recordAudit(target, method);
    if (!permission.allowed) {
      setShowUpgradeModal(true);
      return false;
    }

    return true;
  }, [user, limitReached, recordAudit]);

  const handleUrlAudit = useCallback(async () => {
    setErrorMsg('');

    if (!user) {
      setShowAuthModal(true);
      return;
    }

    setProgressStage('validating');
    setProgressMsg('Validating URL for security...');

    const validation = validateUrl(url);
    if (!validation.valid) {
      setErrorMsg(validation.error || 'Invalid URL');
      setAuditState('error');
      setProgressStage(null);
      return;
    }

    // Check usage limit before fetching
    const targetUrl = validation.sanitizedUrl!;
    const allowed = await checkAuditPermission(targetUrl, 'url');
    if (!allowed) {
      setProgressStage(null);
      return;
    }

    setAuditState('auditing');
    setProgressStage('fetching');
    setProgressMsg(`Fetching web page from ${targetUrl}...`);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), SECURITY_LIMITS.requestTimeout);

      const edgeFunctionUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/fetch-url`;
      const response = await fetch(edgeFunctionUrl, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ url: targetUrl }),
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({ error: null }));
        const message = errorBody.error || `The audit service returned an error (HTTP ${response.status}).`;

        if (response.status === 504) {
          throw new Error(`${message} Try uploading the HTML file directly instead.`);
        } else if (response.status === 502) {
          throw new Error(`${message} Try uploading the HTML file directly instead.`);
        } else if (response.status === 413) {
          throw new Error(message);
        } else if (response.status === 415) {
          throw new Error(message);
        } else if (response.status === 400) {
          throw new Error(message);
        }
        throw new Error(message);
      }

      const data = await response.json();

      if (!data || !data.html || typeof data.html !== 'string') {
        throw new Error('The audit service returned an unexpected response. No HTML content was received.');
      }

      if (data.html.trim().length === 0) {
        throw new Error('The page returned no content. The site may require JavaScript to render content, which this tool cannot execute. Try saving the page as HTML and uploading it directly.');
      }

      const finalUrl = data.finalUrl || targetUrl;
      performAudit(data.html, finalUrl, 'URL fetch (server-side, HTML parsing)');
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setErrorMsg('The request timed out after 30 seconds. The website may be slow or unresponsive. Try uploading the HTML file directly instead.');
      } else if (err instanceof TypeError && err.message.includes('Failed to fetch')) {
        setErrorMsg('Unable to reach the audit service. This could be a temporary network issue. Please try again in a moment, or upload the HTML file directly.');
      } else {
        setErrorMsg(err instanceof Error ? err.message : 'An unexpected error occurred while fetching the page.');
      }
      setAuditState('error');
      setProgressStage(null);
    }
  }, [url, user, checkAuditPermission, performAudit]);

  const handleFileUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setErrorMsg('');

    if (!user) {
      setShowAuthModal(true);
      return;
    }

    if (file.size > SECURITY_LIMITS.maxResponseSize) {
      setErrorMsg('The file is too large (over 5 MB). Please upload a smaller HTML file.');
      setAuditState('error');
      return;
    }

    // Check usage limit before processing file
    const allowed = await checkAuditPermission(file.name, 'file');
    if (!allowed) {
      return;
    }

    setProgressStage('fetching');
    setProgressMsg(`Reading ${file.name}...`);

    const reader = new FileReader();
    reader.onload = (e) => {
      const html = e.target?.result as string;
      if (!html || html.trim().length === 0) {
        setErrorMsg('The file appears to be empty.');
        setAuditState('error');
        setProgressStage(null);
        return;
      }
      performAudit(html, file.name, 'HTML file upload');
    };
    reader.onerror = () => {
      setErrorMsg('Failed to read the file. Please try again.');
      setAuditState('error');
      setProgressStage(null);
    };
    reader.readAsText(file);

    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [user, checkAuditPermission, performAudit]);

  const handleReset = useCallback(() => {
    setResult(null);
    setAuditState('idle');
    setErrorMsg('');
    setUrl('');
    setExpandedFindings(new Set());
    setActiveTab('dashboard');
    setProgressStage(null);
  }, []);

  const handleExport = useCallback((format: 'csv' | 'json' | 'html') => {
    if (!result) return;
    if (format === 'csv') {
      downloadFile(generateReportFilename(result, 'csv'), generateCSV(result), 'text/csv');
    } else if (format === 'json') {
      downloadFile(generateReportFilename(result, 'json'), generateJSON(result), 'application/json');
    } else {
      downloadFile(generateReportFilename(result, 'html'), generateHTMLReport(result), 'text/html');
    }
  }, [result]);

  const severityCounts = result ? {
    critical: result.findings.filter(f => f.severity === 'critical').length,
    serious: result.findings.filter(f => f.severity === 'serious').length,
    moderate: result.findings.filter(f => f.severity === 'moderate').length,
    minor: result.findings.filter(f => f.severity === 'minor').length,
  } : null;

  const potentialCount = result ? result.findings.filter(f => !f.isConfirmed).length : 0;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Header */}
      <header className="bg-gradient-to-r from-slate-900 via-blue-900 to-indigo-900 text-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-white/10 rounded-lg flex items-center justify-center backdrop-blur-sm">
                <ShieldCheck className="w-6 h-6" />
              </div>
              <div>
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight">AccessiCheck AI</h1>
                <p className="text-sm text-blue-200">Make the web more accessible.</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowPricing(true)}
                className="text-sm text-blue-200 hover:text-white transition hidden sm:block"
              >
                Pricing
              </button>
              {user ? (
                <UserMenu onShowPricing={() => setShowPricing(true)} />
              ) : (
                <button
                  onClick={() => setShowAuthModal(true)}
                  className="flex items-center gap-2 px-4 py-2 bg-white text-slate-800 rounded-lg font-medium text-sm hover:bg-blue-50 transition"
                >
                  <LogIn className="w-4 h-4" />
                  Sign In
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        {/* Usage Banner */}
        {user && !isPro && (
          <div className="mb-6 bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
                <Zap className="w-4 h-4 text-blue-600" />
              </div>
              <div>
                <p className="text-sm font-semibold text-blue-800">
                  {remaining} of {FREE_AUDIT_LIMIT} free audits remaining this month
                </p>
                <p className="text-xs text-blue-600 mt-0.5">
                  {remaining > 0
                    ? `You have ${remaining} audit${remaining === 1 ? '' : 's'} left.`
                    : 'You have used all your free audits for this month.'}
                </p>
              </div>
            </div>
            {remaining === 0 && (
              <button
                onClick={() => setShowUpgradeModal(true)}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition whitespace-nowrap flex items-center gap-1.5"
              >
                <Crown className="w-4 h-4" />
                Upgrade
              </button>
            )}
          </div>
        )}

        {/* Limit Reached Alert */}
        {user && limitReached && auditState === 'idle' && (
          <div className="mb-6 bg-amber-50 border border-amber-300 rounded-lg p-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Lock className="w-5 h-5 text-amber-600 flex-shrink-0" />
              <div>
                <p className="text-sm font-semibold text-amber-800">Free audit limit reached</p>
                <p className="text-xs text-amber-700 mt-0.5">
                  You have used all {FREE_AUDIT_LIMIT} free audits this month. Upgrade to Pro for unlimited audits.
                </p>
              </div>
            </div>
            <button
              onClick={() => setShowUpgradeModal(true)}
              className="px-4 py-2 bg-amber-600 text-white rounded-lg text-sm font-medium hover:bg-amber-700 transition whitespace-nowrap flex items-center gap-1.5 flex-shrink-0"
            >
              <Crown className="w-4 h-4" />
              Upgrade to Pro
            </button>
          </div>
        )}

        {/* Sign-in Prompt for unauthenticated users */}
        {!user && auditState === 'idle' && (
          <div className="mb-6 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-5 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
                <ShieldCheck className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-800">Create a free account to start auditing</p>
                <p className="text-xs text-slate-600 mt-0.5">Get {FREE_AUDIT_LIMIT} free accessibility audits per month. No credit card required.</p>
              </div>
            </div>
            <button
              onClick={() => setShowAuthModal(true)}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition whitespace-nowrap flex items-center gap-1.5 flex-shrink-0"
            >
              <LogIn className="w-4 h-4" />
              Get Started
            </button>
          </div>
        )}

        {/* Input Section */}
        {auditState !== 'done' && (
          <section className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 sm:p-8 mb-8">
            <h2 className="text-lg font-semibold text-slate-800 mb-1">Audit a Web Page</h2>
            <p className="text-sm text-slate-500 mb-6">Enter a public website URL or upload an HTML file to check for accessibility issues.</p>

            {/* URL Input */}
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  <Globe className="w-4 h-4 inline mr-1.5 text-slate-400" />
                  Website URL
                </label>
                <div className="flex flex-col sm:flex-row gap-3">
                  <input
                    type="text"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && auditState !== 'auditing' && handleUrlAudit()}
                    placeholder="https://example.com"
                    className="flex-1 px-4 py-3 rounded-lg border border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none transition text-slate-900 placeholder-slate-400"
                    disabled={auditState === 'auditing'}
                  />
                  <button
                    onClick={handleUrlAudit}
                    disabled={auditState === 'auditing' || limitReached}
                    className="px-6 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 focus:ring-2 focus:ring-blue-200 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 whitespace-nowrap"
                  >
                    {auditState === 'auditing' ? (
                      <><Loader2 className="w-4 h-4 animate-spin" /> Auditing...</>
                    ) : limitReached ? (
                      <><Lock className="w-4 h-4" /> Limit Reached</>
                    ) : (
                      <><Zap className="w-4 h-4" /> Run Audit</>
                    )}
                  </button>
                </div>
              </div>

              {/* Divider */}
              <div className="flex items-center gap-3 py-2">
                <div className="flex-1 h-px bg-slate-200" />
                <span className="text-xs text-slate-400 font-medium">OR</span>
                <div className="flex-1 h-px bg-slate-200" />
              </div>

              {/* File Upload */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  <Upload className="w-4 h-4 inline mr-1.5 text-slate-400" />
                  Upload HTML File
                </label>
                <div
                  onClick={() => !limitReached && fileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-lg p-6 text-center transition group ${
                    limitReached
                      ? 'border-slate-200 cursor-not-allowed opacity-50'
                      : 'border-slate-300 cursor-pointer hover:border-blue-400 hover:bg-blue-50/30'
                  }`}
                >
                  <FileCode className="w-8 h-8 mx-auto mb-2 text-slate-400 group-hover:text-blue-500 transition" />
                  <p className="text-sm text-slate-600">
                    <span className="text-blue-600 font-medium">Click to upload</span> an HTML file
                  </p>
                  <p className="text-xs text-slate-400 mt-1">Max 5 MB</p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".html,.htm,text/html"
                    onChange={handleFileUpload}
                    disabled={limitReached}
                    className="hidden"
                  />
                </div>
              </div>
            </div>

            {/* Progress */}
            {auditState === 'auditing' && (
              <div className="mt-6 space-y-3">
                <div className="flex items-center gap-3 text-blue-600 bg-blue-50 rounded-lg p-4">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span className="text-sm font-medium">{progressMsg}</span>
                </div>
                <div className="flex items-center gap-2 px-4">
                  <ProgressStep label="Validate" active={progressStage === 'validating'} done={progressStage === 'fetching' || progressStage === 'analyzing'} />
                  <ProgressStep label="Fetch" active={progressStage === 'fetching'} done={progressStage === 'analyzing'} />
                  <ProgressStep label="Analyze" active={progressStage === 'analyzing'} done={false} />
                </div>
              </div>
            )}

            {/* Error */}
            {auditState === 'error' && errorMsg && (
              <div className="mt-6 flex items-start gap-3 text-red-700 bg-red-50 border border-red-200 rounded-lg p-4">
                <XCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium">{errorMsg}</p>
                  {errorMsg.includes('upload') && (
                    <p className="text-xs text-red-600 mt-1">Tip: Save the web page as HTML and upload it above.</p>
                  )}
                </div>
              </div>
            )}

            {/* Disclaimer */}
            <div className="mt-6 bg-amber-50 border border-amber-200 rounded-lg p-4">
              <div className="flex items-start gap-2">
                <Info className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-amber-800 leading-relaxed">
                  <strong>Disclaimer:</strong> Automated testing cannot detect all accessibility problems.
                  Manual testing is required for keyboard navigation, screen-reader behavior, meaningful alt text,
                  logical focus order, and other contextual issues. This tool does not prove WCAG conformance or legal compliance.
                  See the <a href="https://www.w3.org/WAI/WCAG22/quickref/" target="_blank" rel="noopener noreferrer" className="underline font-medium">WCAG 2.2 Quick Reference</a> for complete guidance.
                </p>
              </div>
            </div>
          </section>
        )}

        {/* Results */}
        {auditState === 'done' && result && (
          <>
            {/* Target Info + Reset */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
              <div>
                <h2 className="text-lg font-semibold text-slate-800">Audit Results</h2>
                <p className="text-sm text-slate-500 mt-0.5">
                  <span className="font-medium text-slate-700">{result.target}</span>
                  {' — '}
                  {new Date(result.testDate).toLocaleString()}
                </p>
              </div>
              <button
                onClick={handleReset}
                className="px-4 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition flex items-center gap-2 self-start"
              >
                <Trash2 className="w-4 h-4" /> New Audit
              </button>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 mb-6 bg-slate-100 p-1 rounded-lg w-fit overflow-x-auto">
              <TabButton active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} icon={<Eye className="w-4 h-4" />} label="Dashboard" />
              <TabButton active={activeTab === 'findings'} onClick={() => setActiveTab('findings')} icon={<AlertTriangle className="w-4 h-4" />} label="Findings" badge={result.findings.length} />
              <TabButton active={activeTab === 'explanations'} onClick={() => setActiveTab('explanations')} icon={<Lightbulb className="w-4 h-4" />} label="Explanations" />
              <TabButton active={activeTab === 'export'} onClick={() => setActiveTab('export')} icon={<Download className="w-4 h-4" />} label="Export" />
            </div>

            {/* Dashboard Tab */}
            {activeTab === 'dashboard' && severityCounts && (
              <div className="space-y-6">
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
                  <StatCard label="Checks Run" value={result.totalChecks} icon={<CheckCircle2 className="w-5 h-5" />} color="slate" />
                  <StatCard label="Total Issues" value={result.findings.length} icon={<AlertTriangle className="w-5 h-5" />} color="blue" />
                  <StatCard label="Critical" value={severityCounts.critical} icon={<AlertTriangle className="w-5 h-5" />} color="red" />
                  <StatCard label="Serious" value={severityCounts.serious} icon={<AlertCircle className="w-5 h-5" />} color="orange" />
                  <StatCard label="Moderate" value={severityCounts.moderate} icon={<Info className="w-5 h-5" />} color="amber" />
                  <StatCard label="Potential" value={potentialCount} icon={<Eye className="w-5 h-5" />} color="purple" />
                </div>

                <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                  <h3 className="text-sm font-semibold text-slate-700 mb-4">Page Structure Overview</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-4">
                    <PageStat label="Elements" value={result.pageStats.totalElements} />
                    <PageStat label="Images" value={result.pageStats.images} />
                    <PageStat label="Buttons" value={result.pageStats.buttons} />
                    <PageStat label="Links" value={result.pageStats.links} />
                    <PageStat label="Form Fields" value={result.pageStats.formControls} />
                    <PageStat label="Headings" value={result.pageStats.headings} />
                    <PageStat label="Landmarks" value={result.pageStats.landmarks} />
                  </div>
                </div>

                <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                  <h3 className="text-sm font-semibold text-slate-700 mb-4">Issues by Severity</h3>
                  {result.findings.length === 0 ? (
                    <div className="flex items-center gap-3 text-green-700 bg-green-50 rounded-lg p-4">
                      <CheckCircle2 className="w-5 h-5" />
                      <p className="text-sm font-medium">No issues were detected by the automated checks. Manual testing is still recommended.</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {(Object.keys(severityCounts) as Severity[]).map(sev => {
                        const count = severityCounts[sev];
                        if (count === 0) return null;
                        const config = severityConfig[sev];
                        const Icon = config.icon;
                        return (
                          <div key={sev} className={`flex items-center gap-3 ${config.bg} ${config.border} border rounded-lg p-3`}>
                            <Icon className={`w-5 h-5 ${config.text}`} />
                            <span className={`text-sm font-medium ${config.text}`}>{config.label}</span>
                            <span className="text-sm text-slate-600">{count} issue{count === 1 ? '' : 's'}</span>
                          </div>
                        );
                      })}
                      {potentialCount > 0 && (
                        <p className="text-xs text-slate-500 italic pl-2">
                          {potentialCount} finding{potentialCount === 1 ? '' : 's'} are potential issues that require manual verification.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Findings Tab */}
            {activeTab === 'findings' && (
              <div className="space-y-4">
                {result.findings.length === 0 ? (
                  <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-12 text-center">
                    <CheckCircle2 className="w-12 h-12 mx-auto text-green-500 mb-3" />
                    <h3 className="text-lg font-semibold text-slate-700">No Issues Found</h3>
                    <p className="text-sm text-slate-500 mt-2 max-w-md mx-auto">
                      The automated checks did not detect any accessibility issues. This is a good sign,
                      but manual testing is still required to verify full accessibility.
                    </p>
                  </div>
                ) : (
                  result.findings.map((finding) => {
                    const config = severityConfig[finding.severity];
                    const Icon = config.icon;
                    const isExpanded = expandedFindings.has(finding.id);
                    return (
                      <div key={finding.id} className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                        <button
                          onClick={() => toggleFinding(finding.id)}
                          className="w-full flex items-start gap-3 p-4 text-left hover:bg-slate-50 transition"
                        >
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${config.bg}`}>
                            <Icon className={`w-4 h-4 ${config.text}`} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${config.bg} ${config.text}`}>
                                {config.label}
                              </span>
                              {!finding.isConfirmed && (
                                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                                  Potential
                                </span>
                              )}
                              <span className="text-xs text-slate-400">{finding.elements.length} element{finding.elements.length === 1 ? '' : 's'}</span>
                            </div>
                            <h3 className="text-sm font-semibold text-slate-800 mt-1">{finding.title}</h3>
                            <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">{finding.description}</p>
                          </div>
                          {isExpanded ? <ChevronDown className="w-5 h-5 text-slate-400 flex-shrink-0 mt-1" /> : <ChevronRight className="w-5 h-5 text-slate-400 flex-shrink-0 mt-1" />}
                        </button>

                        {isExpanded && (
                          <div className="border-t border-slate-100 p-4 space-y-4 bg-slate-50/50">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs font-medium text-slate-600">WCAG 2.2:</span>
                              {finding.wcagCriteria.map(c => (
                                <a
                                  key={c}
                                  href={`https://www.w3.org/WAI/WCAG22/quickref/#${c}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-xs px-2 py-0.5 bg-blue-50 text-blue-700 rounded-full hover:bg-blue-100 transition"
                                >
                                  {c}
                                </a>
                              ))}
                            </div>

                            <div>
                              <p className="text-xs font-semibold text-slate-600 mb-1">Description</p>
                              <p className="text-sm text-slate-700 leading-relaxed">{finding.description}</p>
                            </div>

                            <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                              <p className="text-xs font-semibold text-green-800 mb-1">Suggested Fix</p>
                              <p className="text-sm text-green-900 leading-relaxed">{finding.remediation}</p>
                            </div>

                            <div>
                              <p className="text-xs font-semibold text-slate-600 mb-2">
                                Affected Elements ({finding.elements.length})
                              </p>
                              <div className="space-y-2 max-h-64 overflow-y-auto">
                                {finding.elements.slice(0, 20).map((el, i) => (
                                  <div key={i} className="bg-slate-800 rounded-lg p-3 text-xs">
                                    <code className="text-slate-400 block mb-1">{el.selector}</code>
                                    <pre className="text-green-300 font-mono whitespace-pre-wrap break-all text-xs">{el.snippet}</pre>
                                    <p className="text-slate-400 mt-1 text-xs">{el.issueDetail}</p>
                                  </div>
                                ))}
                                {finding.elements.length > 20 && (
                                  <p className="text-xs text-slate-500 italic text-center py-2">
                                    ...and {finding.elements.length - 20} more
                                  </p>
                                )}
                              </div>
                            </div>

                            <a
                              href={finding.helpUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700 font-medium"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                              Learn more about this rule
                            </a>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {/* Explanations Tab */}
            {activeTab === 'explanations' && (
              <div className="space-y-6">
                <div className="bg-gradient-to-r from-blue-600 to-indigo-600 rounded-xl p-6 text-white">
                  <div className="flex items-center gap-2 mb-3">
                    <Sparkles className="w-5 h-5" />
                    <h3 className="text-base font-semibold">AI Explanation Assistant</h3>
                  </div>
                  {(() => {
                    const explanation = explainFindings(result);
                    return (
                      <>
                        <p className="text-sm text-blue-50 leading-relaxed mb-4">{explanation.summary}</p>
                        <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4">
                          <p className="text-sm font-medium text-white mb-1">Overall Recommendation</p>
                          <p className="text-sm text-blue-50 leading-relaxed">{explanation.overallRecommendation}</p>
                        </div>
                      </>
                    );
                  })()}
                </div>

                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                  <div className="flex items-start gap-2">
                    <Info className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-amber-800 leading-relaxed">{AI_DISCLAIMER}</p>
                  </div>
                </div>

                {explainFindings(result).findings.map((exp) => (
                  <div key={exp.ruleId} className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
                    <h4 className="text-sm font-semibold text-slate-800 mb-2">{exp.title}</h4>
                    <p className="text-sm text-slate-600 leading-relaxed mb-3">{exp.explanation}</p>
                    <div className="bg-slate-800 rounded-lg p-3">
                      <p className="text-xs text-slate-400 mb-1">Suggested code (for review):</p>
                      <pre className="text-green-300 font-mono text-xs whitespace-pre-wrap break-all">{exp.suggestedFix}</pre>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Export Tab */}
            {activeTab === 'export' && (
              <div className="space-y-6">
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                  <h3 className="text-sm font-semibold text-slate-700 mb-1">Download Report</h3>
                  <p className="text-sm text-slate-500 mb-6">Export the audit results in your preferred format. Reports include the target URL, test date, testing method, findings, severity, remediation suggestions, and known limitations.</p>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <ExportButton
                      onClick={() => handleExport('csv')}
                      icon={<FileText className="w-6 h-6" />}
                      title="CSV Report"
                      description="Spreadsheet-compatible. Opens in Excel, Google Sheets, or any CSV reader."
                      format="csv"
                    />
                    <ExportButton
                      onClick={() => handleExport('json')}
                      icon={<FileCode className="w-6 h-6" />}
                      title="JSON Report"
                      description="Structured data for developers. Easy to import into tools and pipelines."
                      format="json"
                    />
                    <ExportButton
                      onClick={() => handleExport('html')}
                      icon={<Globe className="w-6 h-6" />}
                      title="HTML Report"
                      description="Self-contained, styled report. Opens in any browser, printable to PDF."
                      format="html"
                    />
                  </div>
                </div>

                <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                  <h3 className="text-sm font-semibold text-slate-700 mb-4">Report Summary</h3>
                  <div className="space-y-2 text-sm">
                    <ReportRow label="Target" value={result.target} />
                    <ReportRow label="Date" value={new Date(result.testDate).toLocaleString()} />
                    <ReportRow label="Method" value={result.testMethod} />
                    <ReportRow label="Checks Run" value={result.totalChecks.toString()} />
                    <ReportRow label="Total Findings" value={result.findings.length.toString()} />
                    <ReportRow label="Critical" value={severityCounts?.critical.toString() || '0'} />
                    <ReportRow label="Serious" value={severityCounts?.serious.toString() || '0'} />
                    <ReportRow label="Moderate" value={severityCounts?.moderate.toString() || '0'} />
                    <ReportRow label="Potential Issues" value={potentialCount.toString()} />
                  </div>
                </div>

                <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                  <h3 className="text-sm font-semibold text-slate-700 mb-3">Known Limitations</h3>
                  <ul className="space-y-2 text-sm text-slate-600">
                    <li className="flex items-start gap-2"><Info className="w-4 h-4 text-slate-400 flex-shrink-0 mt-0.5" /> Automated testing cannot detect all accessibility problems.</li>
                    <li className="flex items-start gap-2"><Info className="w-4 h-4 text-slate-400 flex-shrink-0 mt-0.5" /> Color contrast is estimated from computed styles and may not reflect actual rendering.</li>
                    <li className="flex items-start gap-2"><Info className="w-4 h-4 text-slate-400 flex-shrink-0 mt-0.5" /> JavaScript-rendered content may not be captured when fetching by URL.</li>
                    <li className="flex items-start gap-2"><Info className="w-4 h-4 text-slate-400 flex-shrink-0 mt-0.5" /> Keyboard navigation and screen-reader behavior require manual testing.</li>
                    <li className="flex items-start gap-2"><Info className="w-4 h-4 text-slate-400 flex-shrink-0 mt-0.5" /> This scan does not prove WCAG conformance or legal compliance.</li>
                  </ul>
                </div>
              </div>
            )}
          </>
        )}

        {/* Empty State */}
        {auditState === 'idle' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-8">
            <FeatureCard
              icon={<Eye className="w-6 h-6" />}
              title="13 Accessibility Checks"
              description="Images, forms, buttons, links, headings, landmarks, contrast, ARIA, keyboard, and more."
            />
            <FeatureCard
              icon={<ShieldCheck className="w-6 h-6" />}
              title="WCAG 2.2 Aligned"
              description="Each finding references the relevant WCAG success criteria with links to official guidance."
            />
            <FeatureCard
              icon={<Download className="w-6 h-6" />}
              title="Exportable Reports"
              description="Download results as CSV, JSON, or a styled HTML report for sharing and documentation."
            />
          </div>
        )}

        {/* Pricing Section (shown when toggled) */}
        {showPricing && auditState === 'idle' && (
          <PricingSection
            isPro={isPro}
            onUpgrade={() => {
              if (!user) {
                setShowPricing(false);
                setShowAuthModal(true);
              } else {
                setShowPricing(false);
                setShowUpgradeModal(true);
              }
            }}
            onClose={() => setShowPricing(false)}
          />
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200 mt-12">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
          <p className="text-xs text-slate-500 text-center">
            AccessiCheck AI — Make the web more accessible. |
            <a href="https://www.w3.org/WAI/WCAG22/quickref/" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline ml-1">WCAG 2.2 Quick Reference</a> |
            <a href="https://www.w3.org/WAI/" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline ml-1">W3C WAI</a>
          </p>
          <p className="text-xs text-slate-400 text-center mt-2">
            Automated testing cannot guarantee full accessibility. Always combine with manual testing.
          </p>
        </div>
      </footer>

      {/* Modals */}
      <AuthModal open={showAuthModal} onClose={() => setShowAuthModal(false)} />
      <UpgradeModal open={showUpgradeModal} onClose={() => setShowUpgradeModal(false)} />
    </div>
  );
}

// Sub-components

function ProgressStep({ label, active, done }: { label: string; active: boolean; done: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      {done ? (
        <CheckCircle2 className="w-4 h-4 text-green-500" />
      ) : active ? (
        <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
      ) : (
        <div className="w-4 h-4 rounded-full border-2 border-slate-300" />
      )}
      <span className={`text-xs font-medium ${active ? 'text-blue-600' : done ? 'text-green-600' : 'text-slate-400'}`}>{label}</span>
    </div>
  );
}

function TabButton({ active, onClick, icon, label, badge }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; badge?: number }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-md text-sm font-medium transition whitespace-nowrap ${
        active ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
      }`}
    >
      {icon}
      {label}
      {badge !== undefined && badge > 0 && (
        <span className={`text-xs px-1.5 py-0.5 rounded-full ${active ? 'bg-blue-100 text-blue-700' : 'bg-slate-200 text-slate-600'}`}>
          {badge}
        </span>
      )}
    </button>
  );
}

function StatCard({ label, value, icon, color }: { label: string; value: number; icon: React.ReactNode; color: string }) {
  const colorMap: Record<string, string> = {
    slate: 'text-slate-600 bg-slate-50',
    blue: 'text-blue-600 bg-blue-50',
    red: 'text-red-600 bg-red-50',
    orange: 'text-orange-600 bg-orange-50',
    amber: 'text-amber-600 bg-amber-50',
    purple: 'text-slate-600 bg-slate-100',
  };
  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-2 ${colorMap[color] || colorMap.slate}`}>
        {icon}
      </div>
      <p className="text-2xl font-bold text-slate-800">{value}</p>
      <p className="text-xs text-slate-500 mt-0.5">{label}</p>
    </div>
  );
}

function PageStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="text-center">
      <p className="text-xl font-bold text-slate-700">{value}</p>
      <p className="text-xs text-slate-500 mt-0.5">{label}</p>
    </div>
  );
}

function FeatureCard({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
      <div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center mb-3">
        {icon}
      </div>
      <h3 className="text-sm font-semibold text-slate-800 mb-1">{title}</h3>
      <p className="text-sm text-slate-500">{description}</p>
    </div>
  );
}

function ExportButton({ onClick, icon, title, description, format }: { onClick: () => void; icon: React.ReactNode; title: string; description: string; format: string }) {
  return (
    <button
      onClick={onClick}
      className="text-left p-4 border border-slate-200 rounded-lg hover:border-blue-400 hover:bg-blue-50/30 transition group"
    >
      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center group-hover:bg-blue-100 group-hover:text-blue-600 transition">
          {icon}
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-800">{title}</p>
          <p className="text-xs text-slate-400 uppercase">.{format}</p>
        </div>
      </div>
      <p className="text-xs text-slate-500">{description}</p>
    </button>
  );
}

function ReportRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between py-1.5 border-b border-slate-100 last:border-0">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-slate-800 text-right">{value}</span>
    </div>
  );
}

function PricingSection({ isPro, onUpgrade, onClose }: { isPro: boolean; onUpgrade: () => void; onClose: () => void }) {
  return (
    <div className="mt-8">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-slate-800">Pricing Plans</h2>
        <button onClick={onClose} className="text-sm text-slate-500 hover:text-slate-700 transition">Close</button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-3xl">
        {/* Free Plan */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <div className="flex items-center gap-2 mb-3">
            <Zap className="w-5 h-5 text-slate-400" />
            <h3 className="text-base font-semibold text-slate-800">Free</h3>
          </div>
          <p className="text-3xl font-bold text-slate-800 mb-4">₹0<span className="text-sm font-normal text-slate-500">/month</span></p>
          <ul className="space-y-2.5 text-sm text-slate-600 mb-6">
            <li className="flex items-center gap-2"><Check className="w-4 h-4 text-green-500" /> {FREE_AUDIT_LIMIT} accessibility audits per month</li>
            <li className="flex items-center gap-2"><Check className="w-4 h-4 text-green-500" /> All 13 accessibility checks</li>
            <li className="flex items-center gap-2"><Check className="w-4 h-4 text-green-500" /> AI-powered explanations</li>
            <li className="flex items-center gap-2"><Check className="w-4 h-4 text-green-500" /> CSV, JSON, and HTML report exports</li>
            <li className="flex items-center gap-2"><Check className="w-4 h-4 text-green-500" /> URL scanning and file upload</li>
          </ul>
          <div className="py-2.5 text-center text-sm font-medium text-slate-500 bg-slate-50 rounded-lg">
            {isPro ? 'Not your current plan' : 'Your current plan'}
          </div>
        </div>

        {/* Pro Plan */}
        <div className="bg-white rounded-xl shadow-sm border-2 border-blue-500 p-6 relative">
          <div className="absolute -top-3 left-6 bg-blue-600 text-white text-xs font-semibold px-3 py-1 rounded-full">Recommended</div>
          <div className="flex items-center gap-2 mb-3">
            <Crown className="w-5 h-5 text-blue-600" />
            <h3 className="text-base font-semibold text-slate-800">Pro</h3>
          </div>
          <p className="text-3xl font-bold text-slate-800 mb-4">₹{PRO_PRICE_INR}<span className="text-sm font-normal text-slate-500">/month</span></p>
          <ul className="space-y-2.5 text-sm text-slate-700 mb-6">
            <li className="flex items-center gap-2"><Check className="w-4 h-4 text-green-500" /> Unlimited accessibility audits</li>
            <li className="flex items-center gap-2"><Check className="w-4 h-4 text-green-500" /> All 13 accessibility checks</li>
            <li className="flex items-center gap-2"><Check className="w-4 h-4 text-green-500" /> AI-powered explanations</li>
            <li className="flex items-center gap-2"><Check className="w-4 h-4 text-green-500" /> All report export formats</li>
            <li className="flex items-center gap-2"><Check className="w-4 h-4 text-green-500" /> URL scanning and file upload</li>
            <li className="flex items-center gap-2"><Check className="w-4 h-4 text-green-500" /> Priority support</li>
          </ul>
          <button
            onClick={onUpgrade}
            disabled={isPro}
            className="w-full py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isPro ? (
              <><Crown className="w-4 h-4 text-amber-400" /> Current Plan</>
            ) : (
              <><Crown className="w-4 h-4" /> Upgrade to Pro</>
            )}
          </button>
          <p className="text-xs text-slate-400 text-center mt-3">Cancel anytime. Secure payment via Razorpay or Stripe.</p>
        </div>
      </div>
    </div>
  );
}

export default App;
