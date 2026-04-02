"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.findNearestClassMatch = findNearestClassMatch;
exports.splitClassesPreservingBrackets = splitClassesPreservingBrackets;
exports.mergeClassTokens = mergeClassTokens;
exports.upsertGroupedClass = upsertGroupedClass;
exports.normalizeColorClass = normalizeColorClass;
exports.normalizeMeasurementClass = normalizeMeasurementClass;
const ATTR_REGEXPS = [
    /(className|class)\s*=\s*"([^"]*)"/g,
    /(className|class)\s*=\s*'([^']*)'/g,
    /(className|class)\s*=\s*\{`([^`]*)`\}/g,
];
function findNearestClassMatch(text, cursorOffset) {
    const matches = [];
    for (const regex of ATTR_REGEXPS) {
        for (const m of text.matchAll(regex)) {
            const full = m[0];
            const attr = m[1];
            const classValue = m[2] ?? '';
            const idx = m.index;
            if (typeof idx !== 'number') {
                continue;
            }
            const valueIndexInMatch = full.indexOf(classValue);
            if (valueIndexInMatch === -1) {
                continue;
            }
            const start = idx + valueIndexInMatch;
            const end = start + classValue.length;
            matches.push({
                value: classValue,
                start,
                end,
                attribute: attr,
            });
        }
    }
    if (matches.length === 0) {
        return null;
    }
    // Prefer exact containment of the cursor first.
    const containing = matches.find((m) => cursorOffset >= m.start && cursorOffset <= m.end);
    if (containing) {
        return containing;
    }
    // Otherwise pick the closest class attribute.
    return matches.reduce((closest, current) => {
        const currentDistance = distanceToRange(cursorOffset, current.start, current.end);
        const closestDistance = distanceToRange(cursorOffset, closest.start, closest.end);
        return currentDistance < closestDistance ? current : closest;
    });
}
function distanceToRange(point, start, end) {
    if (point < start) {
        return start - point;
    }
    if (point > end) {
        return point - end;
    }
    return 0;
}
function splitClassesPreservingBrackets(classValue) {
    const result = [];
    let current = '';
    let depth = 0;
    for (const ch of classValue) {
        if (ch === '[') {
            depth += 1;
            current += ch;
            continue;
        }
        if (ch === ']') {
            depth = Math.max(0, depth - 1);
            current += ch;
            continue;
        }
        if (ch === ' ' && depth === 0) {
            if (current.trim()) {
                result.push(current.trim());
            }
            current = '';
            continue;
        }
        current += ch;
    }
    if (current.trim()) {
        result.push(current.trim());
    }
    return result;
}
function mergeClassTokens(tokens) {
    return tokens.join(' ').replace(/\s+/g, ' ').trim();
}
const GROUP_PATTERNS = [
    {
        id: 'display',
        test: (token) => /^(block|inline-block|inline|flex|inline-flex|grid|hidden)$/.test(token),
    },
    {
        id: 'fontSize',
        test: (token) => /^text-(xs|sm|base|lg|xl|[2-9]xl|\[.+\])$/.test(token),
    },
    {
        id: 'textColor',
        test: (token) => /^text-(?!left$|right$|center$|justify$|start$|end$|xs$|sm$|base$|lg$|xl$|[2-9]xl$).+/.test(token),
    },
    {
        id: 'backgroundColor',
        test: (token) => /^bg-(?!auto$|cover$|contain$|center$|top$|bottom$|left$|right$|repeat$|repeat-x$|repeat-y$|no-repeat$).+/.test(token),
    },
    {
        id: 'padding',
        test: (token) => /^p[trblxy]?-.+/.test(token),
    },
    {
        id: 'margin',
        test: (token) => /^m[trblxy]?-.+/.test(token),
    },
    {
        id: 'rounded',
        test: (token) => /^rounded(?:-[trbl]{1,2})?(?:-.+)?$/.test(token),
    },
];
function upsertGroupedClass(tokens, groupId, nextClass) {
    const group = GROUP_PATTERNS.find((item) => item.id === groupId);
    if (!group) {
        if (!nextClass) {
            return tokens;
        }
        if (tokens.includes(nextClass)) {
            return tokens;
        }
        return [...tokens, nextClass];
    }
    const withoutGroup = tokens.filter((token) => !group.test(token));
    if (!nextClass) {
        return withoutGroup;
    }
    if (!withoutGroup.includes(nextClass)) {
        withoutGroup.push(nextClass);
    }
    return withoutGroup;
}
function normalizeColorClass(prefix, value) {
    const next = value.trim();
    if (!next) {
        return null;
    }
    if (next.startsWith('#') || next.startsWith('rgb(') || next.startsWith('hsl(') || next.startsWith('var(')) {
        return `${prefix}-[${next}]`;
    }
    if (next.startsWith('[') && next.endsWith(']')) {
        return `${prefix}-${next}`;
    }
    return `${prefix}-${next}`;
}
function normalizeMeasurementClass(prefix, value) {
    const next = value.trim();
    if (!next) {
        return null;
    }
    if (/^\d+(\.\d+)?$/.test(next)) {
        return `${prefix}-[${next}px]`;
    }
    if (/^-?\d+(\.\d+)?(px|rem|em|%|vh|vw)$/.test(next)) {
        return `${prefix}-[${next}]`;
    }
    if (next.startsWith('[') && next.endsWith(']')) {
        return `${prefix}-${next}`;
    }
    return `${prefix}-${next}`;
}
