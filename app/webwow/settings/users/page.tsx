'use client';

import { FieldDescription, FieldLegend } from '@/components/ui/field';

export default function UsersSettingsPage() {
  return (
    <div className="max-w-2xl mx-auto py-10 px-6">
      <FieldLegend>Users</FieldLegend>
      <FieldDescription>
        Single-user mode. User management is not available.
        Access is controlled via the ADMIN_PASSWORD environment variable.
      </FieldDescription>
    </div>
  );
}
