'use client';

import { initializeApp, getApps } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  type Auth,
} from 'firebase/auth';

import { env } from './env';

const firebaseConfig = {
  apiKey: env.NEXT_PUBLIC_FIREBASE_API_KEY || 'AIzaSyDFsidZKXEasH7Xsmu1dKOS_-U5tsEWQIk',
  authDomain: env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || 'eatcheck-fefee.firebaseapp.com',
  projectId: env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'eatcheck-fefee',
  storageBucket: env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || 'eatcheck-fefee.firebasestorage.app',
  messagingSenderId: env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '791132606576',
  appId: env.NEXT_PUBLIC_FIREBASE_APP_ID || '1:791132606576:web:CHANGE_ME_WEB_APP_ID',
};

// 避免重复初始化
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

export const auth: Auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

export {
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
};
