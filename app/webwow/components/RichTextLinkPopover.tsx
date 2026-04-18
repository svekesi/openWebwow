'use client';

/**
 * Rich Text Link Popover Component
 *
 * Popover for editing links in TipTap rich text editors.
 * Wraps RichTextLinkSettings and provides apply/remove actions.
 */

import React, { useState, useCallback } from 'react';
import { Editor } from '@tiptap/core';

import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import RichTextLinkSettings from './RichTextLinkSettings';
import SettingsPanel from './SettingsPanel';
import { getLinkSettingsFromMark } from '@/lib/tiptap-extensions/rich-text-link';
import type { Layer, CollectionField, Collection, LinkSettings, LinkType } from '@/types';
import type { FieldGroup } from './CollectionFieldSelector';

export interface RichTextLinkPopoverProps {
  /** TipTap editor instance */
  editor: Editor;
  /** Field groups with labels and sources for inline variable selection */
  fieldGroups?: FieldGroup[];
  /** All fields by collection ID */
  allFields?: Record<string, CollectionField[]>;
  /** Available collections */
  collections?: Collection[];
  /** Whether inside a collection layer */
  isInsideCollectionLayer?: boolean;
  /** Current layer (for context) */
  layer?: Layer | null;
  /** Custom trigger button (optional) */
  trigger?: React.ReactNode;
  /** Whether popover is open (controlled) */
  open?: boolean;
  /** Callback when open state changes (controlled) */
  onOpenChange?: (open: boolean) => void;
  /** Whether the link button is disabled */
  disabled?: boolean;
  /** Link types to exclude from the dropdown */
  excludedLinkTypes?: LinkType[];
  /** Hide "Current page item" and "Reference field" options (e.g. when editing CMS item content) */
  hidePageContextOptions?: boolean;
}

/**
 * Popover for managing rich text links
 */
export default function RichTextLinkPopover({
  editor,
  fieldGroups,
  allFields,
  collections,
  isInsideCollectionLayer = false,
  layer,
  trigger,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  disabled = false,
  excludedLinkTypes = [],
  hidePageContextOptions = false,
}: RichTextLinkPopoverProps) {
  // Use controlled state if provided, otherwise internal state
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;

  // Link settings state
  const [linkSettings, setLinkSettings] = useState<LinkSettings | null>(null);

  // Save selection range and hasLink state when popover opens
  const [savedSelection, setSavedSelection] = useState<{ from: number; to: number } | null>(null);
  const [hadLinkOnOpen, setHadLinkOnOpen] = useState(false);

  // Check if text has link mark (for display only)
  const hasLink = editor.isActive('richTextLink');

  // Custom open change handler that captures selection before opening
  const handleOpenChange = useCallback((newOpen: boolean) => {
    // Prevent opening if disabled
    if (newOpen && disabled) {
      return;
    }

    if (newOpen) {
      // Capture selection and link state BEFORE opening
      let { from, to } = editor.state.selection;

      const currentHasLink = editor.isActive('richTextLink');
      setHadLinkOnOpen(currentHasLink);

      // If cursor is on a link but no text is selected, extend to full mark range
      if (currentHasLink && from === to) {
        const markType = editor.schema.marks.richTextLink;
        if (markType) {
          const $pos = editor.state.doc.resolve(from);
          const start = $pos.parent.childAfter($pos.parentOffset);

          if (start.node) {
            // Find the mark on the current node
            const mark = start.node.marks.find(m => m.type === markType);
            if (mark) {
              // Calculate mark boundaries within the parent
              let markStart = $pos.start();
              let markEnd = $pos.start();
              let foundStart = false;

              $pos.parent.forEach((node, offset) => {
                const hasMark = node.marks.some(m => m.type === markType && m.eq(mark));
                if (hasMark) {
                  if (!foundStart) {
                    markStart = $pos.start() + offset;
                    foundStart = true;
                  }
                  markEnd = $pos.start() + offset + node.nodeSize;
                } else if (foundStart) {
                  // We've passed the mark range
                  return false;
                }
              });

              from = markStart;
              to = markEnd;
            }
          }
        }
      }

      setSavedSelection({ from, to });

      if (currentHasLink) {
        // Get current link attributes from selection
        const attrs = editor.getAttributes('richTextLink');
        setLinkSettings(getLinkSettingsFromMark(attrs));
      } else {
        setLinkSettings(null);
      }
    }

    // Update the open state
    if (isControlled) {
      controlledOnOpenChange!(newOpen);
    } else {
      setInternalOpen(newOpen);
    }
  }, [editor, isControlled, controlledOnOpenChange, disabled]);

  // For closing without going through handleOpenChange
  const closePopover = useCallback(() => {
    if (isControlled) {
      controlledOnOpenChange!(false);
    } else {
      setInternalOpen(false);
    }
  }, [isControlled, controlledOnOpenChange]);

  // Apply link settings to the editor immediately
  const applyToEditor = useCallback((settings: LinkSettings | null, selection: { from: number; to: number } | null) => {
    if (!selection) return;

    const { from, to } = selection;
    const markType = editor.schema.marks.richTextLink;
    if (!markType) return;

    if (!settings) {
      editor.chain()
        .focus()
        .setTextSelection({ from, to })
        .unsetRichTextLink()
        .run();
      return;
    }

    const { state } = editor;
    const tr = state.tr;
    tr.removeMark(from, to, markType);
    tr.addMark(from, to, markType.create(settings as any));
    editor.view.dispatch(tr);
  }, [editor]);

  // Handle settings change — apply immediately
  const handleSettingsChange = useCallback((settings: LinkSettings | null) => {
    setLinkSettings(settings);
    applyToEditor(settings, savedSelection);
  }, [applyToEditor, savedSelection]);

  // Remove link from selection
  const handleRemove = useCallback(() => {
    if (!savedSelection) {
      editor.chain().focus().unsetRichTextLink().run();
      closePopover();
      return;
    }

    const { from, to } = savedSelection;
    editor.chain()
      .focus()
      .setTextSelection({ from, to })
      .unsetRichTextLink()
      .run();
    closePopover();
  }, [editor, savedSelection, closePopover]);

  // Default trigger button
  const defaultTrigger = (
    <Button
      variant={hasLink ? 'default' : 'ghost'}
      size="icon"
      className="size-7"
      title={disabled ? 'Links cannot be nested' : 'Link'}
      disabled={disabled}
    >
      <Icon name="link" className="size-3.5" />
    </Button>
  );

  return (
    <Popover
      open={open}
      onOpenChange={handleOpenChange}
    >
      <PopoverTrigger asChild>
        {trigger || defaultTrigger}
      </PopoverTrigger>

      <PopoverContent
        className="w-64 px-4 py-0"
        align="start"
        side="bottom"
        sideOffset={8}
      >
        <SettingsPanel
          title="Link"
          isOpen={true}
          onToggle={() => {}}
        >

          <RichTextLinkSettings
            value={linkSettings}
            onChange={handleSettingsChange}
            fieldGroups={fieldGroups}
            allFields={allFields}
            collections={collections}
            isInsideCollectionLayer={isInsideCollectionLayer}
            layer={layer}
            excludedLinkTypes={excludedLinkTypes}
            hidePageContextOptions={hidePageContextOptions}
          />
        </SettingsPanel>
      </PopoverContent>
    </Popover>
  );
}
