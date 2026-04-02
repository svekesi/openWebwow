'use client';

import { useAuthStore } from '@/stores/useAuthStore';
import { Button } from '@/components/ui/button';
import { FieldDescription, FieldLegend } from '@/components/ui/field';

export default function ProfilePage() {
  const signOut = useAuthStore((state) => state.signOut);

  return (
    <div className="max-w-2xl mx-auto py-10 px-6">
      <FieldLegend>Profile</FieldLegend>
      <FieldDescription>
        Single-user mode. No profile management needed.
      </FieldDescription>

      <div className="mt-8">
        <Button
          variant="destructive"
          onClick={signOut}
        >
          Sign out
        </Button>
      </div>
    </div>
  );
}
