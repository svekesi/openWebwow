export type CssDeclaration = {
  property: string;
  value: string;
  valueStart: number;
  valueEnd: number;
};

export type CssRuleMatch = {
  selector: string;
  blockStart: number;
  blockEnd: number;
  declarations: CssDeclaration[];
};

export function findNearestCssRule(text: string, cursorOffset: number): CssRuleMatch | null {
  const openBraceIndex = text.lastIndexOf('{', cursorOffset);
  if (openBraceIndex === -1) {
    return null;
  }

  const closeBraceIndex = findMatchingCloseBrace(text, openBraceIndex);
  if (closeBraceIndex === -1) {
    return null;
  }

  const selectorStartIndex = text.lastIndexOf('}', openBraceIndex - 1) + 1;
  const selector = text.slice(selectorStartIndex, openBraceIndex).trim();
  if (!selector) {
    return null;
  }

  const declarations = parseDeclarations(text, openBraceIndex, closeBraceIndex);
  return {
    selector,
    blockStart: openBraceIndex,
    blockEnd: closeBraceIndex,
    declarations,
  };
}

export function buildCssDeclarationEdit(
  text: string,
  match: CssRuleMatch,
  property: string,
  value: string,
): { start: number; end: number; newText: string } {
  const normalizedProperty = property.trim().toLowerCase();
  const existing = match.declarations.find((decl) => decl.property === normalizedProperty);
  if (existing) {
    return {
      start: existing.valueStart,
      end: existing.valueEnd,
      newText: value,
    };
  }

  const baseIndent = detectLineIndent(text, match.blockStart);
  const propertyIndent = `${baseIndent}  `;
  const prefix = needsLeadingLineBreak(text, match.blockStart, match.blockEnd) ? '\n' : '';
  const suffix = needsTrailingLineBreak(text, match.blockEnd) ? '\n' : '';

  return {
    start: match.blockEnd,
    end: match.blockEnd,
    newText: `${prefix}${propertyIndent}${normalizedProperty}: ${value};${suffix}`,
  };
}

function parseDeclarations(text: string, blockStart: number, blockEnd: number): CssDeclaration[] {
  const declarations: CssDeclaration[] = [];
  const blockContentStart = blockStart + 1;
  const blockContent = text.slice(blockContentStart, blockEnd);
  const declarationRegex = /([a-zA-Z-]+)\s*:\s*([^;{}]+)\s*;?/g;

  for (const match of blockContent.matchAll(declarationRegex)) {
    const declarationIndex = match.index;
    if (typeof declarationIndex !== 'number') {
      continue;
    }

    const property = (match[1] || '').trim().toLowerCase();
    const rawValue = (match[2] || '').trim();
    const fullMatch = match[0] || '';
    if (!property || !rawValue || !fullMatch) {
      continue;
    }

    const valueIndexInMatch = fullMatch.indexOf(rawValue);
    if (valueIndexInMatch === -1) {
      continue;
    }

    const declarationStart = blockContentStart + declarationIndex;
    const valueStart = declarationStart + valueIndexInMatch;
    const valueEnd = valueStart + rawValue.length;

    declarations.push({
      property,
      value: rawValue,
      valueStart,
      valueEnd,
    });
  }

  return declarations;
}

function findMatchingCloseBrace(text: string, openBraceIndex: number): number {
  let depth = 0;
  for (let i = openBraceIndex; i < text.length; i += 1) {
    const char = text[i];
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
    }
  }
  return -1;
}

function detectLineIndent(text: string, index: number): string {
  const lineStart = text.lastIndexOf('\n', index) + 1;
  const lineUntilBrace = text.slice(lineStart, index);
  const indentation = lineUntilBrace.match(/^\s*/);
  return indentation ? indentation[0] : '';
}

function needsLeadingLineBreak(text: string, blockStart: number, blockEnd: number): boolean {
  const content = text.slice(blockStart + 1, blockEnd).trim();
  return content.length > 0;
}

function needsTrailingLineBreak(text: string, blockEnd: number): boolean {
  return text[blockEnd - 1] !== '\n';
}
