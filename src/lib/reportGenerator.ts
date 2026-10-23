import type { AuditResult, Finding } from './types';

const severityLabels: Record<string, string> = {
  critical: 'Critical',
  serious: 'Serious',
  moderate: 'Moderate',
  minor: 'Minor',
};

export function downloadFile(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function generateCSV(result: AuditResult): string {
  const headers = [
    'Rule ID',
    'Title',
    'Severity',
    'Category',
    'WCAG Criteria',
    'Confirmed',
    'Elements Affected',
    'Description',
    'Remediation',
    'Help URL',
  ];

  const rows = result.findings.map((f: Finding) => [
    f.ruleId,
    f.title,
    severityLabels[f.severity] || f.severity,
    f.category,
    f.wcagCriteria.join('; '),
    f.isConfirmed ? 'Yes' : 'Potential',
    f.elements.length.toString(),
    escapeCsv(f.description),
    escapeCsv(f.remediation),
    f.helpUrl,
  ]);

  return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
}

function escapeCsv(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

export function generateJSON(result: AuditResult): string {
  return JSON.stringify(result, null, 2);
}

export function generateHTMLReport(result: AuditResult): string {
  const findingsHtml = result.findings.map(f => `
    <div class="finding finding-${f.severity}">
      <h3>${escapeHtml(f.title)}</h3>
      <div class="meta">
        <span class="severity severity-${f.severity}">${severityLabels[f.severity]}</span>
        <span class="badge">${f.isConfirmed ? 'Confirmed' : 'Potential'}</span>
        <span class="category">${f.category}</span>
        <span class="wcag">WCAG: ${f.wcagCriteria.join(', ')}</span>
      </div>
      <p class="description"><strong>Issue:</strong> ${escapeHtml(f.description)}</p>
      <p class="remediation"><strong>Fix:</strong> ${escapeHtml(f.remediation)}</p>
      <p class="elements-count">Affected elements: ${f.elements.length}</p>
      <details>
        <summary>Show affected element snippets</summary>
        <ul class="element-list">
          ${f.elements.slice(0, 10).map(e => `
            <li>
              <code class="selector">${escapeHtml(e.selector)}</code>
              <pre class="snippet">${escapeHtml(e.snippet)}</pre>
              <p class="detail">${escapeHtml(e.issueDetail)}</p>
            </li>
          `).join('')}
        </ul>
      </details>
      <p><a href="${f.helpUrl}" target="_blank" rel="noopener">Learn more about this rule</a></p>
    </div>
  `).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Accessibility Audit Report - ${escapeHtml(result.target)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f8fafc; color: #1e293b; line-height: 1.6; padding: 24px; }
    .header { background: linear-gradient(135deg, #1e1b4b 0%, #1e3a8a 50%, #5b21b6 100%); color: white; padding: 32px; border-radius: 12px; margin-bottom: 24px; }
    .header h1 { font-size: 28px; margin-bottom: 8px; }
    .header .tagline { font-size: 16px; opacity: 0.9; }
    .header .meta { margin-top: 16px; font-size: 14px; opacity: 0.85; }
    .header .meta span { margin-right: 24px; }
    .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 16px; margin-bottom: 24px; }
    .stat { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); text-align: center; }
    .stat .number { font-size: 32px; font-weight: 700; }
    .stat .label { font-size: 12px; color: #64748b; text-transform: uppercase; margin-top: 4px; }
    .stat.critical .number { color: #dc2626; }
    .stat.serious .number { color: #ea580c; }
    .stat.moderate .number { color: #ca8a04; }
    .stat.minor .number { color: #2563eb; }
    .disclaimer { background: #fef3c7; border: 1px solid #fcd34d; padding: 16px 20px; border-radius: 8px; margin-bottom: 24px; font-size: 14px; }
    .disclaimer strong { color: #92400e; }
    .finding { background: white; padding: 20px; border-radius: 8px; margin-bottom: 16px; border-left: 4px solid #ccc; }
    .finding-critical { border-left-color: #dc2626; }
    .finding-serious { border-left-color: #ea580c; }
    .finding-moderate { border-left-color: #ca8a04; }
    .finding-minor { border-left-color: #2563eb; }
    .finding h3 { font-size: 18px; margin-bottom: 8px; }
    .meta { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; font-size: 12px; }
    .severity { padding: 2px 10px; border-radius: 12px; font-weight: 600; color: white; }
    .severity-critical { background: #dc2626; }
    .severity-serious { background: #ea580c; }
    .severity-moderate { background: #ca8a04; }
    .severity-minor { background: #2563eb; }
    .badge { padding: 2px 10px; border-radius: 12px; background: #e2e8f0; color: #475569; }
    .category { padding: 2px 10px; border-radius: 12px; background: #f1f5f9; color: #64748b; }
    .wcag { padding: 2px 10px; border-radius: 12px; background: #ede9fe; color: #5b21b6; }
    .description, .remediation { margin-bottom: 8px; font-size: 14px; }
    .remediation { background: #f0fdf4; padding: 12px; border-radius: 6px; }
    details { margin-top: 8px; }
    summary { cursor: pointer; font-size: 14px; color: #2563eb; }
    .element-list { list-style: none; margin-top: 12px; }
    .element-list li { margin-bottom: 12px; padding: 12px; background: #f8fafc; border-radius: 6px; }
    .selector { font-size: 12px; color: #64748b; display: block; margin-bottom: 4px; }
    .snippet { background: #1e293b; color: #e2e8f0; padding: 8px; border-radius: 4px; font-size: 12px; overflow-x: auto; white-space: pre-wrap; word-break: break-all; }
    .detail { font-size: 13px; color: #475569; margin-top: 4px; }
    .footer { text-align: center; margin-top: 32px; font-size: 13px; color: #64748b; }
    .footer a { color: #2563eb; }
    @media print { .finding { break-inside: avoid; } }
  </style>
</head>
<body>
  <div class="header">
    <h1>AccessiCheck AI - Accessibility Audit Report</h1>
    <div class="tagline">Make the web more accessible.</div>
    <div class="meta">
      <span><strong>Target:</strong> ${escapeHtml(result.target)}</span>
      <span><strong>Date:</strong> ${new Date(result.testDate).toLocaleString()}</span>
      <span><strong>Method:</strong> ${escapeHtml(result.testMethod)}</span>
    </div>
  </div>

  <div class="summary">
    <div class="stat"><div class="number">${result.totalChecks}</div><div class="label">Checks Run</div></div>
    <div class="stat critical"><div class="number">${result.findings.filter(f => f.severity === 'critical').length}</div><div class="label">Critical</div></div>
    <div class="stat serious"><div class="number">${result.findings.filter(f => f.severity === 'serious').length}</div><div class="label">Serious</div></div>
    <div class="stat moderate"><div class="number">${result.findings.filter(f => f.severity === 'moderate').length}</div><div class="label">Moderate</div></div>
    <div class="stat minor"><div class="number">${result.findings.filter(f => f.severity === 'minor').length}</div><div class="label">Minor</div></div>
    <div class="stat"><div class="number">${result.findings.filter(f => !f.isConfirmed).length}</div><div class="label">Potential</div></div>
  </div>

  <div class="disclaimer">
    <strong>Disclaimer:</strong> This automated audit identifies common accessibility issues but cannot detect all problems.
    Manual testing is required for keyboard navigation, screen-reader behavior, meaningful alt text, logical focus order,
    and other contextual issues. An automated scan does not prove WCAG conformance, legal compliance, or complete accessibility.
    Refer to the <a href="https://www.w3.org/WAI/WCAG22/quickref/">WCAG 2.2 Quick Reference</a> for complete guidance.
  </div>

  ${result.findings.length === 0 ? '<p style="text-align:center;font-size:18px;padding:40px;">No accessibility issues were detected by the automated checks. Manual testing is still recommended.</p>' : findingsHtml}

  <div class="footer">
    <p>Generated by AccessiCheck AI on ${new Date(result.testDate).toLocaleString()}</p>
    <p><a href="https://www.w3.org/WAI/WCAG22/quickref/">WCAG 2.2 Quick Reference</a> | <a href="https://www.w3.org/WAI/">W3C Web Accessibility Initiative</a></p>
  </div>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

export function generateReportFilename(result: AuditResult, extension: string): string {
  const date = new Date(result.testDate).toISOString().slice(0, 10);
  const safeTarget = result.target
    .replace(/^https?:\/\//, '')
    .replace(/[^a-zA-Z0-9]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 40);
  return `accessicheck-${safeTarget}-${date}.${extension}`;
}
