'use client';

/**
 * TemplateGallery Component
 *
 * Displays a grid of available templates for selection with category filtering.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { TemplateCard } from './TemplateCard';
import { TemplateApplyDialog } from './TemplateApplyDialog';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import Icon from '@/components/ui/icon';
import { Label } from '@/components/ui/label';
import BuilderLoading from '@/components/BuilderLoading';

interface Template {
  id: string;
  name: string;
  description: string;
  preview: string;
  categoryId: string | null;
  livePreviewUrl: string | null;
}

interface Category {
  id: string;
  name: string;
  order: number;
}

interface TemplateGalleryProps {
  onApplySuccess?: () => void;
  className?: string;
  startFromScratchHref?: string;
  applyImmediately?: boolean;
}

export function TemplateGallery({
  onApplySuccess,
  className,
  startFromScratchHref,
  applyImmediately,
}: TemplateGalleryProps) {
  const router = useRouter();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(
    null
  );
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [showApplyDialog, setShowApplyDialog] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  // Fetch templates and categories on mount
  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);
        setError(null);

        const response = await fetch('/api/templates');
        const data = await response.json().catch(() => null);

        if (!response.ok) {
          const serverMessage =
            data && typeof data.error === 'string' ? data.error : null;
          throw new Error(
            serverMessage ||
              `Failed to fetch templates (HTTP ${response.status})`
          );
        }

        setTemplates(data?.templates || []);
        setCategories(data?.categories || []);
      } catch (err) {
        console.error('[TemplateGallery] Error fetching data:', err);
        setError(
          err instanceof Error ? err.message : 'Failed to load templates'
        );
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, []);

  // Filter templates by selected category
  const filteredTemplates = useMemo(() => {
    if (selectedCategory === 'all') {
      return templates;
    }
    return templates.filter((t) => t.categoryId === selectedCategory);
  }, [templates, selectedCategory]);

  // Clear selected template when category changes and template is no longer visible
  useEffect(() => {
    if (selectedTemplate) {
      const isStillVisible = filteredTemplates.some(
        (t) => t.id === selectedTemplate.id
      );
      if (!isStillVisible) {
        setSelectedTemplate(null);
      }
    }
  }, [filteredTemplates, selectedTemplate]);

  const handleApplyImmediately = async (template: Template) => {
    setApplying(true);
    setApplyError(null);
    setSelectedTemplate(template);

    try {
      const response = await fetch(`/api/templates/${template.id}/apply`, {
        method: 'POST',
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to apply template');
      }

      onApplySuccess?.();
      window.location.href = '/webwow';
    } catch (err) {
      console.error('[TemplateGallery] Apply error:', err);
      setApplyError(
        err instanceof Error ? err.message : 'Failed to apply template'
      );
      setApplying(false);
    }
  };

  const handleTemplateClick = (template: Template) => {
    if (applyImmediately) {
      handleApplyImmediately(template);
      return;
    }
    setSelectedTemplate(template);
    setShowApplyDialog(true);
  };

  const handleApplySuccess = () => {
    setShowApplyDialog(false);
    setSelectedTemplate(null);
    onApplySuccess?.();
  };

  // Loading state
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <EmptyState
        icon="alert-circle"
        title="Failed to load templates"
        description={error}
        actionLabel="Try again"
        onAction={() => window.location.reload()}
      />
    );
  }

  // Empty state
  if (templates.length === 0) {
    return (
      <EmptyState
        icon="layout-template"
        title="No templates available"
        description="Templates will appear here once they are added to the template service."
      />
    );
  }

  if (applying) {
    return (
      <BuilderLoading
        title="Please wait"
        message={`Applying ${selectedTemplate?.name ?? 'template'}...`}
      />
    );
  }

  return (
    <div className={className}>
      {/* Apply error */}
      {applyError && (
        <div className="mb-6 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
          {applyError}
        </div>
      )}

      {/* Category Filter Dropdown */}
      {categories.length > 0 && (
        <div className="mb-6">
          <Select value={selectedCategory} onValueChange={setSelectedCategory}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Select category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {categories.map((category) => (
                <SelectItem key={category.id} value={category.id}>
                  {category.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Template Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {startFromScratchHref && (
          <button
            type="button"
            onClick={() => router.push(startFromScratchHref)}
            className="group flex flex-col gap-3"
          >
            <div className="rounded-lg bg-muted/50 p-8 flex items-center justify-center text-center transition-colors hover:bg-muted aspect-[72/85]">
              <Icon name="plus" className="size-3.5 opacity-75" />
            </div>
            <Label>Start from scratch</Label>
          </button>
        )}
        {filteredTemplates.map((template) => (
          <TemplateCard
            key={template.id}
            name={template.name}
            description={template.description}
            preview={template.preview}
            livePreviewUrl={template.livePreviewUrl}
            onClick={() => handleTemplateClick(template)}
          />
        ))}
      </div>

      {/* Empty state for filtered results */}
      {filteredTemplates.length === 0 && templates.length > 0 && (
        <EmptyState
          icon="layout-template"
          title="No templates in this category"
          description="Try selecting a different category."
        />
      )}

      {/* Apply Confirmation Dialog (only when not in immediate mode) */}
      {!applyImmediately && (
        <TemplateApplyDialog
          open={showApplyDialog}
          onOpenChange={setShowApplyDialog}
          template={selectedTemplate}
          onSuccess={handleApplySuccess}
        />
      )}
    </div>
  );
}

export default TemplateGallery;
