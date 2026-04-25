import { noCache } from '@/lib/api-response';
import { listTemplatesWithCategories } from '@/lib/services/templateService';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /api/templates
 *
 * List all available templates and categories from the template service.
 */
export async function GET() {
  try {
    const { templates, categories } = await listTemplatesWithCategories();

    return noCache({
      templates,
      categories,
      count: templates.length,
    });
  } catch (error) {
    console.error('[GET /api/templates] Error:', error);

    const message =
      error instanceof Error ? error.message : 'Failed to fetch templates';

    return noCache({ error: message }, 500);
  }
}
