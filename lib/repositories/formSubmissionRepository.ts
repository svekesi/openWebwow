import { getKnexClient } from '@/lib/knex-client';
import { jsonb } from '@/lib/knex-helpers';
import type {
  FormSubmission,
  FormSummary,
  CreateFormSubmissionData,
  UpdateFormSubmissionData,
  FormSubmissionStatus,
} from '@/types';

/**
 * Form Submission Repository
 *
 * Handles CRUD operations for form submissions.
 * Uses Knex/PostgreSQL query builder.
 */

/**
 * Get all form submissions, optionally filtered by form_id
 */
export async function getAllFormSubmissions(
  formId?: string,
  status?: FormSubmissionStatus
): Promise<FormSubmission[]> {
  const db = await getKnexClient();

  let query = db('form_submissions')
    .select('*')
    .orderBy('created_at', 'desc');

  if (formId) {
    query = query.where('form_id', formId);
  }

  if (status) {
    query = query.where('status', status);
  }

  const data = await query;

  return data || [];
}

/**
 * Get form submission by ID
 */
export async function getFormSubmissionById(id: string): Promise<FormSubmission | null> {
  const db = await getKnexClient();

  const data = await db('form_submissions')
    .select('*')
    .where('id', id)
    .first();

  return data || null;
}

/**
 * Get all unique forms with submission counts
 */
export async function getFormSummaries(): Promise<FormSummary[]> {
  const db = await getKnexClient();

  // Get all submissions grouped by form_id
  const data = await db('form_submissions')
    .select('form_id', 'status', 'created_at')
    .orderBy('created_at', 'desc');

  if (!data || data.length === 0) {
    return [];
  }

  // Group by form_id and calculate counts
  const formMap = new Map<string, FormSummary>();

  for (const submission of data) {
    const existing = formMap.get(submission.form_id);

    if (existing) {
      existing.submission_count++;
      if (submission.status === 'new') {
        existing.new_count++;
      }
    } else {
      formMap.set(submission.form_id, {
        form_id: submission.form_id,
        submission_count: 1,
        new_count: submission.status === 'new' ? 1 : 0,
        latest_submission: submission.created_at,
      });
    }
  }

  return Array.from(formMap.values());
}

/**
 * Create a new form submission
 */
export async function createFormSubmission(
  submissionData: CreateFormSubmissionData
): Promise<FormSubmission> {
  const db = await getKnexClient();

  const [data] = await db('form_submissions')
    .insert({
      form_id: submissionData.form_id,
      payload: jsonb(submissionData.payload),
      metadata: jsonb(submissionData.metadata || null),
      status: 'new',
      created_at: new Date().toISOString(),
    })
    .returning('*');

  return data;
}

/**
 * Update a form submission (e.g., change status)
 */
export async function updateFormSubmission(
  id: string,
  submissionData: UpdateFormSubmissionData
): Promise<FormSubmission> {
  const db = await getKnexClient();

  const [data] = await db('form_submissions')
    .where('id', id)
    .update(submissionData)
    .returning('*');

  return data;
}

/**
 * Delete a form submission
 */
export async function deleteFormSubmission(id: string): Promise<void> {
  const db = await getKnexClient();

  await db('form_submissions')
    .where('id', id)
    .delete();
}

/**
 * Bulk delete form submissions by IDs
 */
export async function bulkDeleteFormSubmissions(ids: string[]): Promise<void> {
  if (ids.length === 0) return;

  const db = await getKnexClient();

  await db('form_submissions')
    .whereIn('id', ids)
    .delete();
}

/**
 * Delete all submissions for a form
 */
export async function deleteFormSubmissionsByFormId(formId: string): Promise<void> {
  const db = await getKnexClient();

  await db('form_submissions')
    .where('form_id', formId)
    .delete();
}

/**
 * Mark all submissions for a form as read
 */
export async function markAllAsRead(formId: string): Promise<void> {
  const db = await getKnexClient();

  await db('form_submissions')
    .where('form_id', formId)
    .where('status', 'new')
    .update({ status: 'read' });
}
