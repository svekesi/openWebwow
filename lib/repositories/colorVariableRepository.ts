/**
 * Color Variable Repository
 *
 * Data access layer for color variable operations.
 * Color variables are site-wide design tokens stored as CSS custom properties.
 */

import { getKnexClient } from '@/lib/knex-client';
import type { ColorVariable } from '@/types';

export interface CreateColorVariableData {
  name: string;
  value: string;
}

export interface UpdateColorVariableData {
  name?: string;
  value?: string;
}

/**
 * Convert a stored color value (#hex or #hex/opacity) to a CSS-ready value.
 */
function toCssValue(val: string): string {
  const parts = val.split('/');
  if (parts.length < 2) return val;
  const hex = parts[0];
  const opacity = parseInt(parts[1]) / 100;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${opacity})`;
}

/**
 * Generate a `:root { ... }` CSS string with all color variable declarations.
 * Returns null if no variables exist.
 */
export async function generateColorVariablesCss(): Promise<string | null> {
  try {
    const colorVars = await getAllColorVariables();
    if (colorVars.length === 0) return null;
    const declarations = colorVars.map((v) => `--${v.id}: ${toCssValue(v.value)};`).join(' ');
    return `:root { ${declarations} }`;
  } catch {
    return null;
  }
}

export async function getAllColorVariables(): Promise<ColorVariable[]> {
  const db = await getKnexClient();

  const data = await db('color_variables')
    .select('*')
    .orderBy('sort_order', 'asc')
    .orderBy('created_at', 'asc');

  return data || [];
}

export async function getColorVariableById(id: string): Promise<ColorVariable | null> {
  const db = await getKnexClient();

  const data = await db('color_variables')
    .select('*')
    .where('id', id)
    .first();

  return data || null;
}

export async function createColorVariable(
  variableData: CreateColorVariableData
): Promise<ColorVariable> {
  const db = await getKnexClient();

  // Get max sort_order to append at end
  const maxRow = await db('color_variables')
    .select('sort_order')
    .orderBy('sort_order', 'desc')
    .limit(1)
    .first();
  const nextOrder = (maxRow?.sort_order ?? -1) + 1;

  const [data] = await db('color_variables')
    .insert({ ...variableData, sort_order: nextOrder })
    .returning('*');

  return data;
}

export async function updateColorVariable(
  id: string,
  updates: UpdateColorVariableData
): Promise<ColorVariable> {
  const db = await getKnexClient();

  const [data] = await db('color_variables')
    .where('id', id)
    .update({ ...updates, updated_at: new Date().toISOString() })
    .returning('*');

  return data;
}

export async function deleteColorVariable(id: string): Promise<void> {
  const db = await getKnexClient();

  await db('color_variables')
    .where('id', id)
    .delete();
}

export async function reorderColorVariables(
  orderedIds: string[]
): Promise<void> {
  const db = await getKnexClient();

  // Fetch full rows so upsert includes all NOT NULL columns
  const existing = await db('color_variables')
    .select('*')
    .whereIn('id', orderedIds);

  const existingMap = new Map((existing || []).map((v) => [v.id, v]));
  const now = new Date().toISOString();

  const updates = orderedIds
    .map((id, index) => {
      const row = existingMap.get(id);
      if (!row) return null;
      return { ...row, sort_order: index, updated_at: now };
    })
    .filter(Boolean);

  await db('color_variables')
    .insert(updates)
    .onConflict('id')
    .merge();
}
