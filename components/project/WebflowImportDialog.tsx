'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';

type Step = 'upload' | 'processing' | 'complete';

interface ImportStatus {
  status: 'pending' | 'processing' | 'completed' | 'failed';
  warnings: string[];
  errors: string[];
  result?: {
    pages: number;
    collections: number;
    items: number;
    assets: number;
  } | null;
}

interface CreateWebflowImportPayload {
  zipFilename: string;
  zipBase64: string;
  csvFiles: Array<{
    filename: string;
    content: string;
  }>;
}

async function parseResponseSafely(response: Response): Promise<any> {
  const contentType = response.headers.get('content-type') || '';
  const rawText = await response.text();

  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(rawText);
    } catch {
      return { error: rawText || 'Invalid JSON response' };
    }
  }

  // Return raw text for HTML/plaintext errors so UI can show a useful message
  return { error: rawText || `HTTP ${response.status}: ${response.statusText}` };
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

interface WebflowImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function WebflowImportDialog({
  open,
  onOpenChange,
}: WebflowImportDialogProps) {
  const [step, setStep] = useState<Step>('upload');
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [csvFiles, setCsvFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [importId, setImportId] = useState<string | null>(null);
  const [status, setStatus] = useState<ImportStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!open && pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, [open]);

  const resetState = () => {
    setStep('upload');
    setZipFile(null);
    setCsvFiles([]);
    setLoading(false);
    setImportId(null);
    setStatus(null);
    setError(null);
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  };

  const handleClose = () => {
    if (loading && step === 'processing') {
      return;
    }
    resetState();
    onOpenChange(false);
  };

  const pollStatus = (id: string) => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
    }

    pollingRef.current = setInterval(async () => {
      try {
        const response = await fetch(`/webwow/api/webflow/import/${id}/status`);
        const data = await parseResponseSafely(response);
        if (!response.ok) {
          throw new Error(data.error || 'Failed to fetch import status');
        }

        const nextStatus = data.data as ImportStatus;
        setStatus(nextStatus);

        if (nextStatus.status === 'completed' || nextStatus.status === 'failed') {
          setLoading(false);
          setStep('complete');
          if (pollingRef.current) {
            clearInterval(pollingRef.current);
            pollingRef.current = null;
          }
        }
      } catch (err) {
        setLoading(false);
        setError(err instanceof Error ? err.message : 'Import status polling failed');
        setStep('complete');
        if (pollingRef.current) {
          clearInterval(pollingRef.current);
          pollingRef.current = null;
        }
      }
    }, 1500);
  };

  const startImport = async () => {
    if (!zipFile) {
      setError('Bitte ein Webflow ZIP auswählen');
      return;
    }

    setLoading(true);
    setError(null);
    setStep('processing');

    try {
      const formData = new FormData();
      formData.append('webflowZip', zipFile);
      csvFiles.forEach((csvFile) => {
        formData.append('csvFiles', csvFile);
      });

      let createResponse = await fetch('/webwow/api/webflow/import', {
        method: 'POST',
        body: formData,
      });

      let createData = await parseResponseSafely(createResponse);

      // Fallback: some runtimes/proxies fail multipart parsing for large payloads.
      if (!createResponse.ok && String(createData?.error || '').includes('FormData')) {
        const zipBuffer = await zipFile.arrayBuffer();
        const csvPayload = await Promise.all(csvFiles.map(async (csvFile) => ({
          filename: csvFile.name,
          content: await csvFile.text(),
        })));

        const payload: CreateWebflowImportPayload = {
          zipFilename: zipFile.name,
          zipBase64: arrayBufferToBase64(zipBuffer),
          csvFiles: csvPayload,
        };

        createResponse = await fetch('/webwow/api/webflow/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        createData = await parseResponseSafely(createResponse);
      }

      if (!createResponse.ok) {
        throw new Error(createData.error || 'Import-Job konnte nicht erstellt werden');
      }

      const createdImportId: string = createData.data.importId;
      setImportId(createdImportId);

      const processResponse = await fetch('/webwow/api/webflow/import/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ importId: createdImportId }),
      });
      const processData = await parseResponseSafely(processResponse);
      if (!processResponse.ok) {
        throw new Error(processData.error || 'Import konnte nicht gestartet werden');
      }

      pollStatus(createdImportId);
    } catch (err) {
      setLoading(false);
      setStep('complete');
      setError(err instanceof Error ? err.message : 'Import fehlgeschlagen');
    }
  };

  return (
    <Dialog open={open} onOpenChange={loading && step === 'processing' ? undefined : handleClose}>
      <DialogContent
        showCloseButton={!(loading && step === 'processing')}
        className="sm:max-w-lg"
      >
        <DialogHeader>
          <DialogTitle>Webflow importieren</DialogTitle>
          <DialogDescription>
            Importiert Webflow ZIP + CMS CSV in Webwow (Seiten, Collections, Relationen und Assets).
          </DialogDescription>
        </DialogHeader>

        {step === 'upload' && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="webflow-zip">Webflow ZIP</Label>
              <Input
                id="webflow-zip"
                type="file"
                accept=".zip"
                onChange={(event) => setZipFile(event.target.files?.[0] || null)}
              />
              <p className="text-xs text-muted-foreground">
                Export aus Webflow Site Export.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="webflow-csv">CMS CSV-Dateien</Label>
              <Input
                id="webflow-csv"
                type="file"
                accept=".csv"
                multiple
                onChange={(event) => setCsvFiles(Array.from(event.target.files || []))}
              />
              <p className="text-xs text-muted-foreground">
                Optional mehrere CSVs aus dem Webflow CMS Export.
              </p>
            </div>

            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
          </div>
        )}

        {step === 'processing' && (
          <div className="space-y-3 py-2">
            <div className="flex items-center gap-2 text-sm">
              <Spinner />
              Import läuft im Hintergrund...
            </div>
            {importId && (
              <p className="text-xs text-muted-foreground">
                Import ID: {importId}
              </p>
            )}
          </div>
        )}

        {step === 'complete' && (
          <div className="space-y-3">
            {status?.status === 'completed' ? (
              <p className="text-sm text-emerald-600">Import erfolgreich abgeschlossen.</p>
            ) : (
              <p className="text-sm text-destructive">Import fehlgeschlagen.</p>
            )}

            {status?.result && (
              <div className="text-xs text-muted-foreground space-y-1">
                <p>Seiten: {status.result.pages}</p>
                <p>Collections: {status.result.collections}</p>
                <p>Items: {status.result.items}</p>
                <p>Assets: {status.result.assets}</p>
              </div>
            )}

            {status?.warnings && status.warnings.length > 0 && (
              <div className="text-xs text-amber-600 max-h-32 overflow-y-auto space-y-1">
                {status.warnings.slice(0, 10).map((warning, index) => (
                  <p key={`${warning}-${index}`}>- {warning}</p>
                ))}
              </div>
            )}

            {(error || (status?.errors && status.errors.length > 0)) && (
              <div className="text-xs text-destructive max-h-32 overflow-y-auto space-y-1">
                {error && <p>- {error}</p>}
                {status?.errors?.slice(0, 10).map((item, index) => (
                  <p key={`${item}-${index}`}>- {item}</p>
                ))}
              </div>
            )}
          </div>
        )}

        <DialogFooter className="sm:justify-between">
          <Button
            variant="secondary"
            onClick={handleClose}
            disabled={loading && step === 'processing'}
          >
            {step === 'complete' ? 'Schließen' : 'Abbrechen'}
          </Button>
          {step === 'upload' && (
            <Button onClick={startImport} disabled={loading || !zipFile}>
              {loading && <Spinner />}
              Import starten
            </Button>
          )}
          {step === 'complete' && status?.status === 'completed' && (
            <Button
              onClick={() => {
                window.location.href = '/webwow';
              }}
            >
              Builder neu laden
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
