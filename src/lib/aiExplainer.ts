import type { AuditResult, Finding } from './types';

export interface ExplanationResponse {
  summary: string;
  findings: {
    ruleId: string;
    title: string;
    explanation: string;
    suggestedFix: string;
    isSuggestion: boolean;
  }[];
  overallRecommendation: string;
}

const severityLabels: Record<string, string> = {
  critical: 'Critical',
  serious: 'Serious',
  moderate: 'Moderate',
  minor: 'Minor',
};

// Built-in deterministic explanations — no AI API needed
const builtInExplanations: Record<string, { explanation: string; suggestedFix: string }> = {
  'img-alt-missing': {
    explanation: 'Images without alt text are invisible to people using screen readers. When a screen reader encounters an image without alt text, it either skips it entirely or reads the filename, which is rarely helpful. The alt attribute is the most fundamental accessibility feature for images.',
    suggestedFix: '<img src="hero-banner.jpg" alt="Diverse team collaborating in a modern office">\n\nFor decorative images that add no information:\n<img src="spacer.gif" alt="">',
  },
  'form-label-missing': {
    explanation: 'Form fields without labels are unusable by screen reader users. When a screen reader encounters an unlabeled input, it announces just the field type (e.g., "edit text") with no indication of what information is expected. This also affects voice-control users who navigate by saying field names.',
    suggestedFix: '<label for="email">Email Address</label>\n<input type="email" id="email" name="email" required>\n\nOr using aria-label:\n<input type="email" name="email" aria-label="Email Address" required>',
  },
  'button-name-missing': {
    explanation: 'A button without an accessible name is announced as just "button" by screen readers. The user has no idea what action the button performs. This commonly happens with icon-only buttons (like a close X or hamburger menu).',
    suggestedFix: '<button aria-label="Close dialog">\n  <svg aria-hidden="true">...</svg>\n</button>\n\nOr with visible text:\n<button>Submit Form</button>',
  },
  'link-name-missing': {
    explanation: 'Links without text are invisible to screen reader users. This often happens with image-only links or links containing only icons. When navigating by link list (a common screen reader feature), empty links appear as blank entries.',
    suggestedFix: '<a href="/about" aria-label="About Our Team">\n  <img src="info-icon.svg" alt="">\n</a>\n\nOr with visible text:\n<a href="/about">About Our Team</a>',
  },
  'link-text-generic': {
    explanation: 'Generic link text like "click here" or "read more" provides no context when a screen reader user lists all links on the page. The user hears a list of "click here, click here, read more, read more" with no idea where any link goes. Descriptive link text helps everyone, not just screen reader users.',
    suggestedFix: 'Instead of:\n<a href="/report.pdf">Click here</a> to download.\n\nUse:\n<a href="/report.pdf">Download Q3 Accessibility Report (PDF, 2.4MB)</a>',
  },
  'html-lang-missing': {
    explanation: 'The lang attribute on the <html> element tells screen readers what language the page is in. Without it, screen readers use their default language, which can cause them to mispronounce the entire page. This also affects browser translation features.',
    suggestedFix: '<!DOCTYPE html>\n<html lang="en">\n<head>...</head>\n<body>...</body>\n</html>\n\nFor other languages:\n<html lang="es"> (Spanish)\n<html lang="fr"> (French)\n<html lang="hi"> (Hindi)',
  },
  'page-title-missing': {
    explanation: 'The page title is the first thing a screen reader announces when a page loads. It is also what appears in browser tabs, bookmarks, and search results. Without a title, users cannot identify or find the page.',
    suggestedFix: '<head>\n  <title>Contact Us | AccessiCheck AI</title>\n</head>\n\nEach page should have a unique, descriptive title.',
  },
  'heading-hierarchy': {
    explanation: 'Headings create an invisible table of contents that screen reader users navigate by. Skipping heading levels (e.g., jumping from h2 to h4) breaks this structure. Having multiple h1 elements confuses the hierarchy. Think of headings like an outline — each level should be nested within the previous.',
    suggestedFix: '<h1>Product Features</h1>\n  <h2>User Management</h2>\n    <h3>Adding New Users</h3>\n    <h3>Removing Users</h3>\n  <h2>Billing</h2>\n    <h3>Invoice History</h3>\n\nNever skip from h2 to h4. Use one h1 per page.',
  },
  'headings-none': {
    explanation: 'A page with no headings is like a book with no chapter titles. Screen reader users rely on headings to understand page structure and jump to sections. Without headings, they must read through the entire page linearly to find what they need.',
    suggestedFix: '<h1>Contact Us</h1>\n<p>Get in touch with our team.</p>\n<h2>Send a Message</h2>\n<form>...</form>\n<h2>Our Office</h2>\n<p>123 Main Street, Suite 100</p>',
  },
  'duplicate-id': {
    explanation: 'HTML IDs must be unique on a page. Duplicate IDs break label-control associations (the <label for="email"> may point to the wrong field), ARIA references (aria-labelledby may target the wrong element), and in-page links (clicking #section may jump to the wrong place).',
    suggestedFix: '<input id="shipping-name" name="shipping-name">\n<input id="billing-name" name="billing-name">\n\n<label for="shipping-name">Shipping Name</label>\n<label for="billing-name">Billing Name</label>',
  },
  'landmarks-missing': {
    explanation: 'HTML5 landmarks (header, nav, main, footer) let screen reader users jump directly to major sections of a page. Without them, navigating a complex page requires tabbing through every element. Landmarks are the modern equivalent of skip links, but more powerful.',
    suggestedFix: '<body>\n  <header>\n    <nav>...</nav>\n  </header>\n  <main>\n    <h1>Page Title</h1>\n    <article>...</article>\n  </main>\n  <footer>...</footer>\n</body>',
  },
  'color-contrast': {
    explanation: 'Low contrast between text and background makes content hard to read for users with low vision, color blindness, or anyone in bright sunlight. WCAG 2.2 requires a contrast ratio of at least 4.5:1 for normal text and 3:1 for large text. This is a potential finding — the actual contrast may differ from what was computed.',
    suggestedFix: 'Low contrast: <p style="color: #999; background: #fff">Hard to read</p>\nFixed:        <p style="color: #666; background: #fff">Better contrast (5.7:1)</p>\n\nUse a contrast checker like https://webaim.org/resources/contrastchecker/',
  },
  'aria-issues': {
    explanation: 'ARIA attributes, when used incorrectly, can make a page less accessible than if they were not used at all. aria-hidden on focusable elements creates an invisible trap — the element can be reached by keyboard but not seen by screen readers. Invalid ARIA roles confuse assistive technologies.',
    suggestedFix: 'Remove aria-hidden from elements containing focusable controls:\n\nInstead of:\n<div aria-hidden="true">\n  <button>Click me</button>\n</div>\n\nRemove the aria-hidden or move the button outside:\n<div aria-hidden="true">Decorative content</div>\n<button>Click me</button>',
  },
  'skip-link-missing': {
    explanation: 'A skip link is the first thing a keyboard user encounters on a page. It lets them bypass repetitive navigation menus and jump straight to the main content. Without it, a keyboard user must press Tab through every single nav link on every page load.',
    suggestedFix: '<body>\n  <a href="#main-content" class="skip-link">Skip to main content</a>\n  <header><nav>...long navigation...</nav></header>\n  <main id="main-content">\n    <h1>Welcome</h1>\n  </main>\n</body>\n\nCSS:\n.skip-link { position: absolute; left: -9999px; }\n.skip-link:focus { position: static; }',
  },
  'tabindex-positive': {
    explanation: 'Positive tabindex values override the natural tab order of the page. This means keyboard users navigate in an unpredictable sequence that does not match the visual layout. It also creates maintenance problems — if you add a new element, the entire tab order may need renumbering.',
    suggestedFix: 'Remove positive tabindex values entirely.\n\nInstead of: <button tabindex="3">A</button> <button tabindex="1">B</button>\n\nUse:    <button>B</button> <button>A</button> (reorder in HTML)\n\nFor custom widgets:\n<div tabindex="0">Focusable in natural order</div>\n<div tabindex="-1">Focusable only via JavaScript</div>',
  },
};

export function explainFindings(result: AuditResult): ExplanationResponse {
  const criticalCount = result.findings.filter(f => f.severity === 'critical').length;
  const seriousCount = result.findings.filter(f => f.severity === 'serious').length;
  const moderateCount = result.findings.filter(f => f.severity === 'moderate').length;

  let summary = `This audit ran ${result.totalChecks} accessibility checks against ${result.target} and found ${result.findings.length} issue${result.findings.length === 1 ? '' : 's'}.`;

  if (criticalCount > 0) {
    summary += ` ${criticalCount} critical issue${criticalCount === 1 ? '' : 's'} need${criticalCount === 1 ? 's' : ''} immediate attention — these are blocking screen reader users from using the page.`;
  }
  if (seriousCount > 0) {
    summary += ` ${seriousCount} serious issue${seriousCount === 1 ? '' : 's'} significantly impact usability for assistive technology users.`;
  }
  if (moderateCount > 0) {
    summary += ` ${moderateCount} moderate issue${moderateCount === 1 ? '' : 's'} should be addressed to improve the overall experience.`;
  }

  if (result.findings.length === 0) {
    summary = `This audit ran ${result.totalChecks} accessibility checks against ${result.target} and found no issues detectable by automated testing. This is a good sign, but manual testing is still required to verify keyboard navigation, screen-reader behavior, and contextual issues that automated tools cannot detect.`;
  }

  const findings = result.findings.map((f: Finding) => {
    const builtIn = builtInExplanations[f.ruleId];
    return {
      ruleId: f.ruleId,
      title: f.title,
      explanation: builtIn?.explanation || f.description,
      suggestedFix: builtIn?.suggestedFix || f.remediation,
      isSuggestion: true,
    };
  });

  let overallRecommendation = '';
  if (criticalCount > 0) {
    overallRecommendation = 'Start by fixing all critical issues — they prevent screen reader users from accessing core page functionality. Then address serious issues, followed by moderate ones.';
  } else if (seriousCount > 0) {
    overallRecommendation = 'Address the serious issues first — they significantly impact users of assistive technologies. Then work through moderate issues at your own pace.';
  } else if (moderateCount > 0) {
    overallRecommendation = 'No critical or serious issues were found. Address the moderate issues to further improve accessibility for all users.';
  } else {
    overallRecommendation = 'No issues were detected by automated checks. Consider manual testing with a screen reader and keyboard-only navigation to verify full accessibility.';
  }

  overallRecommendation += ' After making fixes, re-run this audit to verify the issues are resolved. All suggested code is a starting point — human review and retesting are required.';

  return { summary, findings, overallRecommendation };
}

export const AI_DISCLAIMER = 'These explanations and code suggestions are generated from built-in accessibility knowledge, not an AI model. All suggested code is a starting point for your review — always test changes with real users and assistive technologies before considering an issue resolved.';
