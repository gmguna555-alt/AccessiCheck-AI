export type Severity = 'critical' | 'serious' | 'moderate' | 'minor';

export type CheckCategory =
  | 'images'
  | 'forms'
  | 'links'
  | 'structure'
  | 'headings'
  | 'landmarks'
  | 'contrast'
  | 'keyboard'
  | 'aria'
  | 'other';

export interface Finding {
  id: string;
  ruleId: string;
  title: string;
  severity: Severity;
  category: CheckCategory;
  wcagCriteria: string[];
  description: string;
  remediation: string;
  helpUrl: string;
  elements: AffectedElement[];
  isConfirmed: boolean;
}

export interface AffectedElement {
  selector: string;
  snippet: string;
  issueDetail: string;
}

export interface AuditResult {
  target: string;
  testDate: string;
  testMethod: string;
  totalChecks: number;
  violations: number;
  findings: Finding[];
  pageStats: {
    totalElements: number;
    images: number;
    buttons: number;
    links: number;
    formControls: number;
    headings: number;
    landmarks: number;
  };
}

export interface CheckResult {
  passed: boolean;
  findings: Finding[];
}
