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

const firebaseConfig = {
  apiKey: 'AIzaSyBkYe0ugZ77xj53CC2t3IGNAlAbmGdhqRs',
  authDomain: 'procify-toolkit.firebaseapp.com',
  projectId: 'procify-toolkit',
  storageBucket: 'procify-toolkit.firebasestorage.app',
  messagingSenderId: '956471694634',
  appId: '1:956471694634:web:fd5eea09ecce8284fd3a53',
  measurementId: 'G-2N2N619PZS',
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
