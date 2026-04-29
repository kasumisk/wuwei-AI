'use client';

import { useEffect, useState } from 'react';
import Lottie from 'lottie-react';

type LottieAnimationData = Record<string, unknown>;

export function EatCheckHeroLottie() {
  const [animationData, setAnimationData] = useState<LottieAnimationData | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch('/animations/eatcheck-hero.json')
      .then((response) => response.json() as Promise<LottieAnimationData>)
      .then((data) => {
        if (!cancelled) setAnimationData(data);
      })
      .catch(() => {
        if (!cancelled) setAnimationData(null);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="relative mx-auto w-full max-w-[34rem] overflow-hidden rounded-[2rem] border border-white/80 bg-white shadow-[0_28px_90px_rgba(15,23,42,0.10)] sm:rounded-[2.5rem]">
      <div className="aspect-[4/3] w-full bg-[#fbfefa]">
        {animationData ? (
          <Lottie
            animationData={animationData}
            autoplay
            loop
            renderer="svg"
            rendererSettings={{ preserveAspectRatio: 'xMidYMid meet' }}
            className="h-full w-full"
          />
        ) : null}
      </div>
    </div>
  );
}
