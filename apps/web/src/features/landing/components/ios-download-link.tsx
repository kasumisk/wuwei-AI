'use client';

import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';

const IOS_APP_STORE_URL = 'https://apps.apple.com/us/app/eatcheck/id6763199295';

export function IosDownloadLink() {
  const qrRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let active = true;

    const renderQr = async () => {
      if (!qrRef.current) return;

      const { default: QRCodeStyling } = await import('qr-code-styling');
      if (!active || !qrRef.current) return;

      qrRef.current.innerHTML = '';

      const qrCode = new QRCodeStyling({
        width: 168,
        height: 168,
        data: IOS_APP_STORE_URL,
        margin: 0,
        qrOptions: { errorCorrectionLevel: 'M' },
        backgroundOptions: { color: 'transparent' },
        dotsOptions: { color: '#0f172a', type: 'rounded' },
        cornersSquareOptions: { color: '#10b981', type: 'extra-rounded' },
        cornersDotOptions: { color: '#10b981', type: 'dot' },
      });

      qrCode.append(qrRef.current);
    };

    renderQr().catch(() => {
      if (qrRef.current) qrRef.current.innerHTML = '';
    });

    return () => {
      active = false;
      if (qrRef.current) qrRef.current.innerHTML = '';
    };
  }, []);

  return (
    <div className="group relative inline-flex w-fit flex-col items-start">
      <motion.div
        whileHover={{ y: -2, scale: 1.015 }}
        whileTap={{ scale: 0.985 }}
        transition={{ duration: 0.2 }}
      >
        <a
          href={IOS_APP_STORE_URL}
          target="_blank"
          rel="noreferrer"
          className="group relative inline-flex items-center justify-center overflow-hidden rounded-full bg-slate-950 px-6 py-3.5 text-sm font-semibold tracking-[-0.01em] text-white shadow-[0_22px_60px_rgba(15,23,42,0.22)] transition will-change-transform focus:outline-none focus:ring-4 focus:ring-slate-300"
        >
          <span className="absolute inset-0 translate-y-full bg-emerald-600/90 transition-transform duration-500 ease-out group-hover:translate-y-0" />
          <span className="relative z-10 flex items-center gap-2">
            Download for iPhone
            <span className="transition-transform duration-300 group-hover:translate-x-1">→</span>
          </span>
        </a>
      </motion.div>

      <div className="pointer-events-none absolute left-1/2 top-full z-20 mt-4 hidden w-56 -translate-x-1/2 rounded-[1.6rem] border border-white/70 bg-white/92 p-4 text-center shadow-[0_28px_90px_rgba(15,23,42,0.16)] opacity-0 backdrop-blur-xl transition duration-200 md:block group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
        <div className="mx-auto flex h-42 w-42 items-center justify-center overflow-hidden rounded-[1.2rem] bg-slate-50 ring-1 ring-slate-200/80">
          <div ref={qrRef} aria-hidden="true" />
        </div>
        <p className="mt-3 text-sm font-semibold tracking-[-0.02em] text-slate-900">
          Scan on your iPhone
        </p>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          Open the App Store page directly from your phone.
        </p>
      </div>
    </div>
  );
}
