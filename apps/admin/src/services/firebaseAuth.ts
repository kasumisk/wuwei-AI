declare global {
  interface Window {
    firebase?: any;
  }
}

const FIREBASE_APP_SCRIPT = 'https://www.gstatic.com/firebasejs/10.13.2/firebase-app-compat.js';
const FIREBASE_AUTH_SCRIPT =
  'https://www.gstatic.com/firebasejs/10.13.2/firebase-auth-compat.js';

let firebaseLoader: Promise<any> | null = null;

function getFirebaseConfig() {
  const apiKey = import.meta.env.VITE_FIREBASE_API_KEY;
  const authDomain = import.meta.env.VITE_FIREBASE_AUTH_DOMAIN;
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID;
  const appId = import.meta.env.VITE_FIREBASE_APP_ID;

  if (!apiKey || !authDomain || !projectId || !appId) {
    throw new Error('Firebase Web 配置缺失，请检查 VITE_FIREBASE_* 环境变量');
  }

  return {
    apiKey,
    authDomain,
    projectId,
    appId,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
  };
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[data-firebase-src="${src}"]`
    );
    if (existing) {
      if (existing.dataset.loaded === 'true') {
        resolve();
        return;
      }
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error(`加载 Firebase 脚本失败: ${src}`)), {
        once: true,
      });
      return;
    }

    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.dataset.firebaseSrc = src;
    script.onload = () => {
      script.dataset.loaded = 'true';
      resolve();
    };
    script.onerror = () => reject(new Error(`加载 Firebase 脚本失败: ${src}`));
    document.head.appendChild(script);
  });
}

async function getFirebase() {
  if (!firebaseLoader) {
    firebaseLoader = (async () => {
      await loadScript(FIREBASE_APP_SCRIPT);
      await loadScript(FIREBASE_AUTH_SCRIPT);

      if (!window.firebase) {
        throw new Error('Firebase SDK 初始化失败');
      }

      if (!window.firebase.apps?.length) {
        window.firebase.initializeApp(getFirebaseConfig());
      }

      return window.firebase;
    })();
  }

  return firebaseLoader;
}

export async function signInAdminWithGoogle(): Promise<string> {
  const firebase = await getFirebase();
  const auth = firebase.auth();
  await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);

  const provider = new firebase.auth.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });

  const credential = await auth.signInWithPopup(provider);
  return credential.user.getIdToken(true);
}

export async function signOutAdminFirebase(): Promise<void> {
  const firebase = await getFirebase();
  await firebase.auth().signOut();
}
