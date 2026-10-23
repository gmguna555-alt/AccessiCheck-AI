import type { Finding, AffectedElement, AuditResult, CheckResult, Severity, CheckCategory } from './types';

let findingCounter = 0;

function nextId(): string {
  findingCounter += 1;
  return `finding-${findingCounter}`;
}

function truncateSnippet(html: string, maxLen = 200): string {
  const cleaned = html.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= maxLen) return cleaned;
  return cleaned.slice(0, maxLen - 3) + '...';
}

function getSelector(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const id = el.id ? `#${el.id}` : '';
  const cls = el.className && typeof el.className === 'string'
    ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.')
    : '';
  return `${tag}${id}${cls}`;
}

function makeFinding(
  ruleId: string,
  title: string,
  severity: Severity,
  category: CheckCategory,
  wcagCriteria: string[],
  description: string,
  remediation: string,
  helpUrl: string,
  elements: AffectedElement[],
  isConfirmed = true,
): Finding {
  return {
    id: nextId(),
    ruleId,
    title,
    severity,
    category,
    wcagCriteria,
    description,
    remediation,
    helpUrl,
    elements,
    isConfirmed,
  };
}

type CheckFn = (doc: Document) => CheckResult;

function checkImagesMissingAlt(): CheckFn {
  return (doc) => {
    const imgs = Array.from(doc.querySelectorAll('img'));
    const affected: AffectedElement[] = [];

    for (const img of imgs) {
      const alt = img.getAttribute('alt');
      if (alt === null) {
        affected.push({
          selector: getSelector(img),
          snippet: truncateSnippet(img.outerHTML),
          issueDetail: 'Missing "alt" attribute entirely. Screen readers cannot describe this image.',
        });
      } else if (alt.trim() === '') {
        // Empty alt is valid for decorative images, but we flag as potential
        affected.push({
          selector: getSelector(img),
          snippet: truncateSnippet(img.outerHTML),
          issueDetail: 'Has an empty "alt" attribute. This is correct for decorative images, but if the image conveys information, it needs descriptive alt text.',
        });
      }
    }

    return {
      passed: affected.length === 0,
      findings: affected.length === 0 ? [] : [
        makeFinding(
          'img-alt-missing',
          'Images missing alternative text',
          'critical',
          'images',
          ['1.1.1'],
          'Images without alt text are invisible to screen reader users. Decorative images should use alt="" while informative images need concise descriptive text.',
          'Add an alt attribute to every <img>. For informative images, describe the image in 125 characters or fewer. For purely decorative images, use alt="". Example: <img src="logo.png" alt="Company Logo">',
          'https://www.w3.org/WAI/WCAG22/quickref/#non-text-content',
          affected,
        ),
      ],
    };
  };
}

function checkFormControlsMissingLabels(): CheckFn {
  return (doc) => {
    const controls = Array.from(doc.querySelectorAll('input, select, textarea'));
    const affected: AffectedElement[] = [];

    for (const control of controls) {
      const input = control as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
      const type = input.getAttribute('type') || 'text';

      // Skip hidden, submit, button, reset, image — these have implicit labels
      if (['hidden', 'submit', 'button', 'reset', 'image'].includes(type)) continue;

      const ariaLabel = input.getAttribute('aria-label');
      const ariaLabelledby = input.getAttribute('aria-labelledby');
      const id = input.id;

      // Check for associated <label for="id">
      let hasLabel = false;
      if (ariaLabel && ariaLabel.trim()) hasLabel = true;
      if (ariaLabelledby) hasLabel = true;
      if (id) {
        const label = doc.querySelector(`label[for="${CSS.escape(id)}"]`);
        if (label && label.textContent?.trim()) hasLabel = true;
      }

      // Check for wrapping <label>
      const parent = input.parentElement;
      if (parent && parent.tagName === 'LABEL' && parent.textContent?.trim()) hasLabel = true;

      // Check for aria-hidden inputs (sometimes decorative)
      if (input.getAttribute('aria-hidden') === 'true') continue;

      if (!hasLabel) {
        affected.push({
          selector: getSelector(input),
          snippet: truncateSnippet(input.outerHTML),
          issueDetail: `No accessible label found. Checked for: <label for>, aria-label, aria-labelledby, and wrapping <label>.`,
        });
      }
    }

    return {
      passed: affected.length === 0,
      findings: affected.length === 0 ? [] : [
        makeFinding(
          'form-label-missing',
          'Form controls without accessible labels',
          'critical',
          'forms',
          ['1.3.1', '3.3.2', '4.1.2'],
          'Form controls without labels are unusable by screen reader users and make forms difficult for everyone. Every input, select, and textarea needs a programmatically associated label.',
          'Associate a <label> with each control using the for attribute, or use aria-label. Example: <label for="email">Email</label> <input id="email" type="email" name="email">',
          'https://www.w3.org/WAI/WCAG22/quickref/#labels-or-instructions',
          affected,
        ),
      ],
    };
  };
}

function checkButtonsMissingNames(): CheckFn {
  return (doc) => {
    const buttons = Array.from(doc.querySelectorAll('button'));
    const affected: AffectedElement[] = [];

    for (const btn of buttons) {
      const text = btn.textContent?.trim() || '';
      const ariaLabel = btn.getAttribute('aria-label')?.trim() || '';
      const ariaLabelledby = btn.getAttribute('aria-labelledby');
      const title = btn.getAttribute('title')?.trim() || '';

      // Check if button contains an img with alt
      const innerImg = btn.querySelector('img[alt]');
      const innerImgAlt = innerImg?.getAttribute('alt')?.trim() || '';

      const hasName = text || ariaLabel || ariaLabelledby || title || innerImgAlt;

      if (!hasName) {
        affected.push({
          selector: getSelector(btn),
          snippet: truncateSnippet(btn.outerHTML),
          issueDetail: 'No accessible name found. Button has no text content, aria-label, aria-labelledby, title, or inner image with alt text.',
        });
      }
    }

    return {
      passed: affected.length === 0,
      findings: affected.length === 0 ? [] : [
        makeFinding(
          'button-name-missing',
          'Buttons without accessible names',
          'critical',
          'forms',
          ['4.1.2'],
          'Buttons without accessible names are announced as "button" by screen readers, leaving users unable to understand what action will occur.',
          'Add visible text inside the button, or use aria-label. Example: <button aria-label="Close dialog">✕</button> or <button>Submit Form</button>',
          'https://www.w3.org/WAI/WCAG22/quickref/#name-role-value',
          affected,
        ),
      ],
    };
  };
}

function checkLinksMissingText(): CheckFn {
  return (doc) => {
    const links = Array.from(doc.querySelectorAll('a[href]'));
    const affected: AffectedElement[] = [];

    for (const link of links) {
      const text = link.textContent?.trim() || '';
      const ariaLabel = link.getAttribute('aria-label')?.trim() || '';
      const ariaLabelledby = link.getAttribute('aria-labelledby');
      const title = link.getAttribute('title')?.trim() || '';

      // Check for inner img with alt
      const innerImg = link.querySelector('img[alt]');
      const innerImgAlt = innerImg?.getAttribute('alt')?.trim() || '';

      // Check for meaningful text that is not just generic
      const genericTexts = ['click here', 'here', 'read more', 'more', 'link', 'this page', 'this link'];
      const isGeneric = genericTexts.includes(text.toLowerCase());

      const hasName = text || ariaLabel || ariaLabelledby || title || innerImgAlt;

      if (!hasName) {
        affected.push({
          selector: getSelector(link),
          snippet: truncateSnippet(link.outerHTML),
          issueDetail: 'No accessible name. Link has no text content, aria-label, title, or inner image with alt text.',
        });
      } else if (isGeneric) {
        affected.push({
          selector: getSelector(link),
          snippet: truncateSnippet(link.outerHTML),
          issueDetail: `Link text "${text}" is generic and does not describe the destination. Screen reader users navigating by link list will not know where this goes.`,
        });
      }
    }

    if (affected.length === 0) return { passed: true, findings: [] };

    // Split into two findings: missing names and generic text
    const missingName = affected.filter(a => a.issueDetail.startsWith('No accessible name'));
    const genericName = affected.filter(a => a.issueDetail.startsWith('Link text'));

    const findings: Finding[] = [];

    if (missingName.length > 0) {
      findings.push(makeFinding(
        'link-name-missing',
        'Links without accessible names',
        'serious',
        'links',
        ['2.4.4', '4.1.2'],
        'Links without text or labels are unusable by screen reader users and cannot be identified when navigating by link list.',
        'Add descriptive text inside the link, or use aria-label. Example: <a href="/about">About Our Team</a> or <a href="/pdf" aria-label="Download Q3 Report (PDF)">Download</a>',
        'https://www.w3.org/WAI/WCAG22/quickref/#link-purpose-in-context',
        missingName,
      ));
    }

    if (genericName.length > 0) {
      findings.push(makeFinding(
        'link-text-generic',
        'Links with generic text',
        'moderate',
        'links',
        ['2.4.4', '2.4.9'],
        'Generic link text like "click here" or "read more" does not provide context. Screen reader users who list links out of context cannot determine the destination.',
        'Replace generic text with descriptive text that makes sense out of context. Example: Change "Click here to download" to "Download the Q3 Accessibility Report (PDF)"',
        'https://www.w3.org/WAI/WCAG22/quickref/#link-purpose-in-context',
        genericName,
      ));
    }

    return { passed: false, findings };
  };
}

function checkMissingLang(): CheckFn {
  return (doc) => {
    const html = doc.documentElement;
    const lang = html.getAttribute('lang');

    if (lang && lang.trim()) return { passed: true, findings: [] };

    return {
      passed: false,
      findings: [
        makeFinding(
          'html-lang-missing',
          'Missing document language',
          'serious',
          'structure',
          ['3.1.1'],
          'The <html> element does not have a "lang" attribute. Screen readers need this to pronounce content correctly. Without it, the screen reader uses its default language, which may produce unintelligible speech.',
          'Add a lang attribute to the <html> element. Example: <html lang="en"> for English, <html lang="es"> for Spanish.',
          'https://www.w3.org/WAI/WCAG22/quickref/#language-of-page',
          [{
            selector: 'html',
            snippet: truncateSnippet(html.outerHTML),
            issueDetail: 'The <html> element is missing the "lang" attribute.',
          }],
        ),
      ],
    };
  };
}

function checkPageTitle(): CheckFn {
  return (doc) => {
    const title = doc.querySelector('title');
    const titleText = title?.textContent?.trim() || '';

    if (titleText) return { passed: true, findings: [] };

    return {
      passed: false,
      findings: [
        makeFinding(
          'page-title-missing',
          'Missing or empty page title',
          'serious',
          'structure',
          ['2.4.2'],
          'The page has no <title> element or the title is empty. The page title is the first thing screen reader users hear when loading a page, and it helps all users identify and find the page in browser tabs.',
          'Add a descriptive, unique <title> element in the <head>. Example: <title>Accessibility Audit Report | AccessiCheck AI</title>',
          'https://www.w3.org/WAI/WCAG22/quickref/#page-titled',
          [{
            selector: 'title',
            snippet: title ? truncateSnippet(title.outerHTML) : '<title> (element not found in <head>)',
            issueDetail: 'No valid page title was found.',
          }],
        ),
      ],
    };
  };
}

function checkHeadingHierarchy(): CheckFn {
  return (doc) => {
    const headings = Array.from(doc.querySelectorAll('h1, h2, h3, h4, h5, h6'));
    const affected: AffectedElement[] = [];
    let hasH1 = false;

    headings.forEach((h, i) => {
      const level = parseInt(h.tagName[1]);

      if (level === 1) hasH1 = true;

      // Check for skipped levels
      if (i > 0) {
        const prev = headings[i - 1];
        const prevLevel = parseInt(prev.tagName[1]);
        if (level > prevLevel + 1) {
          affected.push({
            selector: getSelector(h),
            snippet: truncateSnippet(h.outerHTML),
            issueDetail: `Heading level jumps from h${prevLevel} to h${level}. Heading levels should not skip.`,
          });
        }
      }
    });

    // Check for multiple h1s
    const h1s = headings.filter(h => h.tagName === 'H1');
    if (h1s.length > 1) {
      for (const h1 of h1s) {
        affected.push({
          selector: getSelector(h1),
          snippet: truncateSnippet(h1.outerHTML),
          issueDetail: `Multiple h1 elements found (${h1s.length} total). Using a single h1 per page is recommended.`,
        });
      }
    }

    // No headings at all
    if (headings.length === 0) {
      return {
        passed: false,
        findings: [
          makeFinding(
            'headings-none',
            'No heading elements found',
            'serious',
            'headings',
            ['1.3.1', '2.4.6'],
            'The page contains no heading elements (h1–h6). Headings create a navigational structure that screen reader users rely on to understand and move through page content.',
            'Add a single h1 for the main page title, then use h2–h6 hierarchically for sections. Example: <h1>Product Features</h1> <h2>Pricing Plans</h2>',
            'https://www.w3.org/WAI/WCAG22/quickref/#headings-and-labels',
            [{
              selector: 'document',
              snippet: 'No h1–h6 elements found in the document',
              issueDetail: 'No heading elements were found.',
            }],
          ),
        ],
      };
    }

    if (!hasH1 && headings.length > 0) {
      affected.push({
        selector: 'document',
        snippet: 'No h1 element found — the page has headings but no main heading',
        issueDetail: 'No h1 element was found. Every page should have exactly one h1 as its main title.',
      });
    }

    if (affected.length === 0) return { passed: true, findings: [] };

    return {
      passed: false,
      findings: [
        makeFinding(
          'heading-hierarchy',
          'Heading hierarchy problems',
          'moderate',
          'headings',
          ['1.3.1', '2.4.6'],
          'Heading levels should be sequential (h1 → h2 → h3) without skipping. Each page should have exactly one h1. Improper heading order breaks navigation for screen reader users.',
          'Use one h1 for the page title. Use h2 for major sections, h3 for subsections, etc. Never skip a level (e.g., do not jump from h2 to h4).',
          'https://www.w3.org/WAI/WCAG22/quickref/#headings-and-labels',
          affected,
        ),
      ],
    };
  };
}

function checkDuplicateIds(): CheckFn {
  return (doc) => {
    const allElements = Array.from(doc.querySelectorAll('[id]'));
    const idMap = new Map<string, Element[]>();

    for (const el of allElements) {
      const id = el.id;
      if (!id) continue;
      const existing = idMap.get(id);
      if (existing) {
        existing.push(el);
      } else {
        idMap.set(id, [el]);
      }
    }

    const affected: AffectedElement[] = [];

    for (const [id, els] of idMap) {
      if (els.length > 1) {
        for (const el of els) {
          affected.push({
            selector: getSelector(el),
            snippet: truncateSnippet(el.outerHTML),
            issueDetail: `Duplicate id="${id}" appears ${els.length} times on the page. IDs must be unique.`,
          });
        }
      }
    }

    if (affected.length === 0) return { passed: true, findings: [] };

    return {
      passed: false,
      findings: [
        makeFinding(
          'duplicate-id',
          'Duplicate HTML IDs',
          'serious',
          'structure',
          ['4.1.1'],
          'Duplicate id attributes break label-control associations, ARIA references, and bookmark links. Each id on a page must be unique.',
          'Change duplicate ids to unique values. If the id is referenced by a <label for>, aria-labelledby, or anchor link, update those references too. Example: Change id="name" to id="shipping-name" and id="billing-name".',
          'https://www.w3.org/WAI/WCAG22/quickref/#parsing',
          affected,
        ),
      ],
    };
  };
}

function checkLandmarks(): CheckFn {
  return (doc) => {
    const hasMain = doc.querySelector('main, [role="main"]');
    const hasHeader = doc.querySelector('header, [role="banner"]');
    const hasFooter = doc.querySelector('footer, [role="contentinfo"]');
    const hasNav = doc.querySelector('nav, [role="navigation"]');

    const missing: AffectedElement[] = [];

    if (!hasMain) {
      missing.push({
        selector: 'document',
        snippet: 'No <main> element or role="main" found',
        issueDetail: 'No main landmark found. The main landmark identifies the primary content of the page.',
      });
    }
    if (!hasHeader) {
      missing.push({
        selector: 'document',
        snippet: 'No <header> element or role="banner" found',
        issueDetail: 'No banner/header landmark found. The banner typically contains the site logo and primary navigation.',
      });
    }
    if (!hasNav) {
      missing.push({
        selector: 'document',
        snippet: 'No <nav> element or role="navigation" found',
        issueDetail: 'No navigation landmark found. Navigation landmarks help screen reader users find their way around the site.',
      });
    }
    if (!hasFooter) {
      missing.push({
        selector: 'document',
        snippet: 'No <footer> element or role="contentinfo" found',
        issueDetail: 'No contentinfo/footer landmark found. The footer typically contains copyright, privacy, and contact links.',
      });
    }

    if (missing.length === 0) return { passed: true, findings: [] };

    return {
      passed: false,
      findings: [
        makeFinding(
          'landmarks-missing',
          'Missing landmarks or structural elements',
          'moderate',
          'landmarks',
          ['1.3.1', '2.4.1'],
          'HTML5 landmarks (header, nav, main, footer) help screen reader users understand page structure and navigate efficiently. Missing landmarks make content harder to locate.',
          'Use semantic HTML5 elements: <header> for site banner, <nav> for navigation, <main> for primary content, <footer> for page footer. These create landmarks automatically. Example: <main><article>...</article></main>',
          'https://www.w3.org/WAI/WCAG22/quickref/#bypass-blocks',
          missing,
        ),
      ],
    };
  };
}

function checkColorContrast(): CheckFn {
  return (doc) => {
    const affected: AffectedElement[] = [];

    const textElements = Array.from(doc.querySelectorAll('p, span, a, li, td, div, label, button, h1, h2, h3, h4, h5, h6, strong, em, small'));

    for (const el of textElements) {
      const style = window.getComputedStyle(el);
      const color = style.color;
      const bg = style.backgroundColor;
      const fontSize = parseFloat(style.fontSize);
      const fontWeight = style.fontWeight;

      // Skip if no text
      if (!el.textContent?.trim()) continue;
      // Skip if parent has text (avoid duplicates - only check leaf-ish nodes)
      if (el.children.length > 0 && Array.from(el.children).some(c => c.textContent?.trim())) continue;

      const ratio = calculateContrastRatio(color, bg);
      if (ratio === null) continue;

      // WCAG 2.2: Normal text needs 4.5:1, large text (18pt or 14pt bold) needs 3:1
      const isLarge = fontSize >= 24 || (fontSize >= 18.66 && (fontWeight === 'bold' || parseInt(fontWeight) >= 700));
      const threshold = isLarge ? 3 : 4.5;

      if (ratio < threshold) {
        affected.push({
          selector: getSelector(el),
          snippet: truncateSnippet(el.outerHTML),
          issueDetail: `Color contrast ratio is ${ratio.toFixed(2)}:1 (required: ${threshold}:1 for ${isLarge ? 'large' : 'normal'} text). Foreground: ${color}, Background: ${bg}.`,
        });
      }
    }

    if (affected.length === 0) return { passed: true, findings: [] };

    // This is a potential issue — computed styles may not match real rendering
    return {
      passed: false,
      findings: [
        makeFinding(
          'color-contrast',
          'Potentially low color contrast',
          'serious',
          'contrast',
          ['1.4.3'],
          'Text with insufficient contrast against its background is difficult to read for users with low vision and in bright sunlight. WCAG requires at least 4.5:1 for normal text and 3:1 for large text.',
          'Increase the contrast between text and background colors. Use a contrast checker to verify. Example: Change gray text (#999) on white to darker gray (#666) or black (#000).',
          'https://www.w3.org/WAI/WCAG22/quickref/#contrast-minimum',
          affected.slice(0, 50), // Cap to avoid overwhelming output
          false, // potential — requires manual verification
        ),
      ],
    };
  };
}

function parseColor(color: string): [number, number, number] | null {
  if (!color || color === 'transparent' || color === 'rgba(0, 0, 0, 0)') return null;

  // rgb(r, g, b) or rgba(r, g, b, a)
  const rgbMatch = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgbMatch) {
    return [parseInt(rgbMatch[1]), parseInt(rgbMatch[2]), parseInt(rgbMatch[3])];
  }

  // #hex
  const hexMatch = color.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hexMatch) {
    const hex = hexMatch[1];
    if (hex.length === 3) {
      return [
        parseInt(hex[0] + hex[0], 16),
        parseInt(hex[1] + hex[1], 16),
        parseInt(hex[2] + hex[2], 16),
      ];
    }
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
    ];
  }

  return null;
}

function getLuminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map(v => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function calculateContrastRatio(fg: string, bg: string): number | null {
  const fgRgb = parseColor(fg);
  const bgRgb = parseColor(bg);
  if (!fgRgb || !bgRgb) return null;

  const l1 = getLuminance(fgRgb);
  const l2 = getLuminance(bgRgb);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);

  return (lighter + 0.05) / (darker + 0.05);
}

function checkAriaIssues(): CheckFn {
  return (doc) => {
    const affected: AffectedElement[] = [];

    // Check for aria-hidden on focusable elements
    const ariaHiddenFocusable = Array.from(doc.querySelectorAll('[aria-hidden="true"]')).filter(el => {
      return el.matches('a, button, input, select, textarea, [tabindex]') ||
        el.querySelector('a, button, input, select, textarea, [tabindex]');
    });

    for (const el of ariaHiddenFocusable) {
      affected.push({
        selector: getSelector(el),
        snippet: truncateSnippet(el.outerHTML),
        issueDetail: 'Element has aria-hidden="true" but contains or is a focusable element. This makes it invisible to screen readers but still focusable, creating a confusing dead zone.',
      });
    }

    // Check for invalid ARIA roles
    const validRoles = ['alert', 'alertdialog', 'application', 'article', 'banner', 'button', 'cell', 'checkbox', 'columnheader', 'combobox', 'complementary', 'contentinfo', 'definition', 'dialog', 'directory', 'document', 'feed', 'figure', 'form', 'grid', 'gridcell', 'group', 'heading', 'img', 'link', 'list', 'listitem', 'listbox', 'log', 'main', 'marquee', 'math', 'menu', 'menubar', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'navigation', 'none', 'note', 'option', 'presentation', 'progressbar', 'radio', 'radiogroup', 'region', 'row', 'rowgroup', 'rowheader', 'scrollbar', 'search', 'searchbox', 'separator', 'slider', 'spinbutton', 'status', 'switch', 'tab', 'table', 'tablist', 'tabpanel', 'textbox', 'timer', 'toolbar', 'tooltip', 'tree', 'treegrid', 'treeitem', 'navigation'];
    const roleEls = Array.from(doc.querySelectorAll('[role]'));
    for (const el of roleEls) {
      const role = el.getAttribute('role') || '';
      if (role && !validRoles.includes(role)) {
        affected.push({
          selector: getSelector(el),
          snippet: truncateSnippet(el.outerHTML),
          issueDetail: `Invalid ARIA role: "${role}". This role is not in the WAI-ARIA specification.`,
        });
      }
    }

    if (affected.length === 0) return { passed: true, findings: [] };

    return {
      passed: false,
      findings: [
        makeFinding(
          'aria-issues',
          'ARIA usage problems',
          'serious',
          'aria',
          ['4.1.2', '4.1.3'],
          'Misused ARIA can make accessibility worse than no ARIA at all. aria-hidden on focusable elements creates invisible traps, and invalid roles confuse assistive technologies.',
          'Remove aria-hidden from elements that contain focusable controls, or remove the focusable elements. Use only valid WAI-ARIA roles from the specification. When in doubt, use semantic HTML instead of ARIA.',
          'https://www.w3.org/WAI/WCAG22/quickref/#name-role-value',
          affected.slice(0, 30),
        ),
      ],
    };
  };
}

function checkSkipLink(): CheckFn {
  return (doc) => {
    const firstLink = doc.querySelector('a');
    if (!firstLink) return { passed: true, findings: [] };

    const href = firstLink.getAttribute('href') || '';
    const text = firstLink.textContent?.trim().toLowerCase() || '';

    if (href.startsWith('#') && (text.includes('skip') || text.includes('jump'))) {
      return { passed: true, findings: [] };
    }

    // Also check for any link that looks like a skip link
    const allLinks = Array.from(doc.querySelectorAll('a'));
    const hasSkipLink = allLinks.some(a => {
      const h = a.getAttribute('href') || '';
      const t = a.textContent?.trim().toLowerCase() || '';
      return h.startsWith('#') && (t.includes('skip') || t.includes('jump to main') || t.includes('skip to content'));
    });

    if (hasSkipLink) return { passed: true, findings: [] };

    return {
      passed: false,
      findings: [
        makeFinding(
          'skip-link-missing',
          'No skip-to-content link found',
          'moderate',
          'keyboard',
          ['2.4.1'],
          'A skip link allows keyboard users to bypass repeated navigation and jump directly to the main content. Without it, keyboard users must tab through every nav link on every page.',
          'Add a skip link as the first focusable element. It should be visually hidden until focused. Example: <a href="#main" class="skip-link">Skip to main content</a> ... <main id="main">',
          'https://www.w3.org/WAI/WCAG22/quickref/#bypass-blocks',
          [{
            selector: 'document',
            snippet: 'No skip link found at the top of the page',
            issueDetail: 'No link with "skip" or "jump" text pointing to a fragment was found.',
          }],
          false, // potential — some sites handle this differently
        ),
      ],
    };
  };
}

function checkTabindexMisuse(): CheckFn {
  return (doc) => {
    const affected: AffectedElement[] = [];
    const tabbable = Array.from(doc.querySelectorAll('[tabindex]'));

    for (const el of tabbable) {
      const tabindex = el.getAttribute('tabindex');
      if (tabindex && parseInt(tabindex) > 0) {
        affected.push({
          selector: getSelector(el),
          snippet: truncateSnippet(el.outerHTML),
          issueDetail: `tabindex="${tabindex}" is greater than 0. This removes the element from the natural tab order and creates an unpredictable focus sequence for keyboard users.`,
        });
      }
    }

    if (affected.length === 0) return { passed: true, findings: [] };

    return {
      passed: false,
      findings: [
        makeFinding(
          'tabindex-positive',
          'Positive tabindex values found',
          'moderate',
          'keyboard',
          ['2.4.3'],
          'Positive tabindex values disrupt the natural tab order of the page, making keyboard navigation unpredictable and confusing.',
          'Remove positive tabindex values. Use tabindex="0" to make a non-focusable element focusable, or tabindex="-1" to remove it from the tab order while keeping it programmatically focusable.',
          'https://www.w3.org/WAI/WCAG22/quickref/#focus-order',
          affected.slice(0, 20),
        ),
      ],
    };
  };
}

// All checks to run
const allChecks: { name: string; fn: CheckFn }[] = [
  { name: 'Images missing alt text', fn: checkImagesMissingAlt() },
  { name: 'Form controls missing labels', fn: checkFormControlsMissingLabels() },
  { name: 'Buttons missing names', fn: checkButtonsMissingNames() },
  { name: 'Links missing text', fn: checkLinksMissingText() },
  { name: 'Missing document language', fn: checkMissingLang() },
  { name: 'Missing page title', fn: checkPageTitle() },
  { name: 'Heading hierarchy', fn: checkHeadingHierarchy() },
  { name: 'Duplicate IDs', fn: checkDuplicateIds() },
  { name: 'Missing landmarks', fn: checkLandmarks() },
  { name: 'Color contrast', fn: checkColorContrast() },
  { name: 'ARIA issues', fn: checkAriaIssues() },
  { name: 'Skip link', fn: checkSkipLink() },
  { name: 'Tabindex misuse', fn: checkTabindexMisuse() },
];

export function runAudit(htmlContent: string, target: string, method: string): AuditResult {
  findingCounter = 0;

  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlContent, 'text/html');

  // If the parsed doc has no body content, try HTML parsing
  if (!doc.body || doc.body.children.length === 0) {
    doc.body.innerHTML = htmlContent;
  }

  const findings: Finding[] = [];

  for (const check of allChecks) {
    const result = check.fn(doc);
    findings.push(...result.findings);
  }

  // Sort findings by severity
  const severityOrder: Record<Severity, number> = { critical: 0, serious: 1, moderate: 2, minor: 3 };
  findings.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  const pageStats = {
    totalElements: doc.querySelectorAll('*').length,
    images: doc.querySelectorAll('img').length,
    buttons: doc.querySelectorAll('button').length,
    links: doc.querySelectorAll('a[href]').length,
    formControls: doc.querySelectorAll('input, select, textarea').length,
    headings: doc.querySelectorAll('h1, h2, h3, h4, h5, h6').length,
    landmarks: doc.querySelectorAll('main, nav, header, footer, aside, section, [role="main"], [role="navigation"], [role="banner"], [role="contentinfo"], [role="complementary"], [role="region"]').length,
  };

  return {
    target,
    testDate: new Date().toISOString(),
    testMethod: method,
    totalChecks: allChecks.length,
    violations: findings.length,
    findings,
    pageStats,
  };
}
