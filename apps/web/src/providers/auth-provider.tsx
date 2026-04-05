'use client';

import { useEffect } from 'react';
import { GoogleOAuthProvider } from '@react-oauth/google';
import { useAuth } from '@/lib/hooks/use-auth';

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { restoreAuth } = useAuth();

  useEffect(() => {
    restoreAuth();
  }, [restoreAuth]);

  if (GOOGLE_CLIENT_ID) {
    return (
      <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
        {children}
      </GoogleOAuthProvider>
    );
  }

  return <>{children}</>;
}
