/**
 * Localisation Publishing Service
 * Handles publishing of locales and translations
 */

import { getKnexClient } from '@/lib/knex-client';
import type { Locale, Translation } from '@/types';

export interface PublishLocalisationResult {
  locales: number;
  translations: number;
  timing: {
    localesDurationMs: number;
    translationsDurationMs: number;
  };
}

/**
 * Publish all draft locales and translations
 * Creates/updates published versions while keeping drafts unchanged
 */
export async function publishLocalisation(): Promise<PublishLocalisationResult> {
  const db = await getKnexClient();

  const deletedAt = new Date().toISOString();
  let publishedLocalesCount = 0;
  let publishedTranslationsCount = 0;
  let localesDurationMs = 0;
  let translationsDurationMs = 0;

  // === LOCALES ===
  const localesStart = performance.now();

  const allDraftLocales: Locale[] = await db('locales')
    .select('*')
    .where('is_published', false);

  if (allDraftLocales && allDraftLocales.length > 0) {
    const activeDraftLocales = allDraftLocales.filter((l) => l.deleted_at === null);
    const softDeletedDraftLocales = allDraftLocales.filter((l) => l.deleted_at !== null);

    if (softDeletedDraftLocales.length > 0) {
      const localeIds = softDeletedDraftLocales.map((locale) => locale.id);
      await db('locales')
        .update({ deleted_at: deletedAt })
        .whereIn('id', localeIds)
        .where('is_published', true)
        .whereNull('deleted_at');
    }

    if (activeDraftLocales.length > 0) {
      const existingPublished = await db('locales')
        .select('id')
        .where('is_published', true)
        .whereIn('id', activeDraftLocales.map((l) => l.id));

      const existingPublishedIds = new Set(existingPublished?.map(l => l.id) || []);

      const localesToInsert: any[] = [];
      const localesToUpdate: any[] = [];

      for (const locale of activeDraftLocales) {
        const publishedData = {
          id: locale.id,
          code: locale.code,
          label: locale.label,
          is_default: locale.is_default,
          is_published: true,
          created_at: locale.created_at,
          updated_at: locale.updated_at,
          deleted_at: null,
        };

        if (existingPublishedIds.has(locale.id)) {
          localesToUpdate.push(publishedData);
        } else {
          localesToInsert.push(publishedData);
        }
      }

      if (localesToInsert.length > 0) {
        await db('locales').insert(localesToInsert);
      }

      if (localesToUpdate.length > 0) {
        await db('locales')
          .insert(localesToUpdate)
          .onConflict(['id', 'is_published'])
          .merge();
      }

      publishedLocalesCount = activeDraftLocales.length;
    }
  }

  localesDurationMs = Math.round(performance.now() - localesStart);

  // === TRANSLATIONS ===
  const translationsStart = performance.now();

  const allDraftTranslations: Translation[] = await db('translations')
    .select('*')
    .where('is_published', false);

  if (allDraftTranslations && allDraftTranslations.length > 0) {
    const activeDraftTranslations = allDraftTranslations.filter((t) => t.deleted_at === null);
    const softDeletedDraftTranslations = allDraftTranslations.filter((t) => t.deleted_at !== null);

    if (softDeletedDraftTranslations.length > 0) {
      const translationIds = softDeletedDraftTranslations.map((translation) => translation.id);
      await db('translations')
        .update({ deleted_at: deletedAt })
        .whereIn('id', translationIds)
        .where('is_published', true)
        .whereNull('deleted_at');
    }

    if (activeDraftTranslations.length > 0) {
      const existingPublished = await db('translations')
        .select('id')
        .where('is_published', true)
        .whereIn('id', activeDraftTranslations.map((t) => t.id));

      const existingPublishedIds = new Set(existingPublished?.map(t => t.id) || []);

      const translationsToInsert: any[] = [];
      const translationsToUpdate: any[] = [];

      for (const translation of activeDraftTranslations) {
        const publishedData = {
          id: translation.id,
          locale_id: translation.locale_id,
          source_type: translation.source_type,
          source_id: translation.source_id,
          content_key: translation.content_key,
          content_type: translation.content_type,
          content_value: translation.content_value,
          is_completed: translation.is_completed,
          is_published: true,
          created_at: translation.created_at,
          updated_at: translation.updated_at,
          deleted_at: null,
        };

        if (existingPublishedIds.has(translation.id)) {
          translationsToUpdate.push(publishedData);
        } else {
          translationsToInsert.push(publishedData);
        }
      }

      if (translationsToInsert.length > 0) {
        await db('translations').insert(translationsToInsert);
      }

      if (translationsToUpdate.length > 0) {
        await db('translations')
          .insert(translationsToUpdate)
          .onConflict(['id', 'is_published'])
          .merge();
      }

      publishedTranslationsCount = activeDraftTranslations.length;
    }
  }

  translationsDurationMs = Math.round(performance.now() - translationsStart);

  return {
    locales: publishedLocalesCount,
    translations: publishedTranslationsCount,
    timing: {
      localesDurationMs,
      translationsDurationMs,
    },
  };
}
