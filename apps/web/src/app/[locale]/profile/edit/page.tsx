'use client';

import { Suspense } from 'react';
import { ProfileEditForm } from '@/features/profile/components/profile-edit-form';

export default function ProfileEditPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-background">
          <div className="text-muted-foreground text-sm">加载中...</div>
        </div>
      }
    >
      <ProfileEditForm />
    </Suspense>
  );
}
