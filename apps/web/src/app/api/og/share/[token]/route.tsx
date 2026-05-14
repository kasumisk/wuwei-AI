import { ImageResponse } from 'next/og';
import type { PublicShareResponse } from '@/lib/share/types';

export const runtime = 'edge';

type RouteContext = {
  params: Promise<{ token: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { token } = await context.params;
  const share = await getShareForOg(token);

  if (!share) {
    return new ImageResponse(
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#050807',
          color: 'white',
          fontSize: 64,
          fontWeight: 900,
        }}
      >
        EatCheck
      </div>,
      { width: 1200, height: 630 },
    );
  }

  const snapshot = share.snapshot;
  const score = Math.max(0, Math.min(100, Math.round(snapshot.score ?? 0)));
  const metrics = snapshot.metrics.slice(0, 4);

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        position: 'relative',
        overflow: 'hidden',
        background: '#050807',
        color: 'white',
        fontFamily: 'Inter, Arial, sans-serif',
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: -160,
          top: -180,
          width: 620,
          height: 620,
          borderRadius: 999,
          background: 'rgba(145,247,142,0.22)',
          filter: 'blur(70px)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          right: -220,
          bottom: -220,
          width: 720,
          height: 720,
          borderRadius: 999,
          background: 'rgba(34,211,238,0.14)',
          filter: 'blur(80px)',
        }}
      />
      <div style={{ display: 'flex', width: '100%', padding: 64, gap: 46 }}>
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
            <div
              style={{
                display: 'flex',
                width: 58,
                height: 58,
                borderRadius: 20,
                alignItems: 'center',
                justifyContent: 'center',
                background: 'rgba(255,255,255,0.12)',
                border: '1px solid rgba(255,255,255,0.16)',
                fontSize: 18,
                fontWeight: 900,
              }}
            >
              EC
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ fontSize: 24, fontWeight: 900, letterSpacing: -1 }}>EatCheck</div>
              <div style={{ fontSize: 14, color: 'rgba(209,255,200,0.58)', letterSpacing: 4 }}>AI HEALTH</div>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div
              style={{
                display: 'flex',
                width: 'fit-content',
                padding: '10px 18px',
                borderRadius: 999,
                background: 'rgba(145,247,142,0.12)',
                border: '1px solid rgba(209,255,200,0.16)',
                color: 'rgba(209,255,200,0.78)',
                fontSize: 18,
                fontWeight: 800,
              }}
            >
              AI analyzed this meal
            </div>
            <div
              style={{
                marginTop: 24,
                fontSize: snapshot.type === 'shock_insight' ? 76 : 68,
                lineHeight: 0.92,
                letterSpacing: -5,
                fontWeight: 950,
                maxWidth: 690,
              }}
            >
              {snapshot.hook}
            </div>
            <div style={{ marginTop: 24, fontSize: 26, lineHeight: 1.35, color: 'rgba(240,253,244,0.72)', maxWidth: 640 }}>
              {snapshot.summary.slice(0, 145)}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 14 }}>
            {snapshot.foods.slice(0, 3).map((food) => (
              <div key={food.name} style={{ display: 'flex', borderRadius: 999, padding: '12px 18px', background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.82)', fontSize: 18, fontWeight: 800 }}>
                {food.name}
              </div>
            ))}
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            width: 354,
            borderRadius: 44,
            padding: 28,
            background: 'rgba(255,255,255,0.09)',
            border: '1px solid rgba(255,255,255,0.16)',
            boxShadow: '0 36px 130px rgba(0,0,0,0.52)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ color: 'rgba(209,255,200,0.48)', fontSize: 16, fontWeight: 800, letterSpacing: 3 }}>MEAL SCORE</div>
              <div style={{ marginTop: 8, fontSize: 28, fontWeight: 950, letterSpacing: -1.5 }}>{snapshot.title}</div>
            </div>
          </div>
          <div
            style={{
              marginTop: 30,
              display: 'flex',
              alignSelf: 'center',
              width: 176,
              height: 176,
              borderRadius: 999,
              background: 'conic-gradient(#9dff93 0deg, #eaffd0 135deg, #24593b 290deg, #9dff93 360deg)',
              padding: 8,
            }}
          >
            <div style={{ display: 'flex', flex: 1, borderRadius: 999, background: '#07100c', alignItems: 'center', justifyContent: 'center', fontSize: 62, fontWeight: 950, letterSpacing: -5 }}>
              {score}
            </div>
          </div>

          <div style={{ marginTop: 30, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {metrics.map((metric) => (
              <div key={metric.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderRadius: 22, padding: '14px 16px', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <div style={{ fontSize: 17, color: 'rgba(209,255,200,0.56)', fontWeight: 800 }}>{metric.label}</div>
                <div style={{ fontSize: 26, fontWeight: 950, letterSpacing: -1 }}>
                  {metric.value}<span style={{ fontSize: 16, color: 'rgba(255,255,255,0.55)', marginLeft: 4 }}>{metric.unit}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>,
    { width: 1200, height: 630 },
  );
}

async function getShareForOg(token: string): Promise<PublicShareResponse | null> {
  const baseUrl = process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL;
  if (!baseUrl) return null;

  try {
    const response = await fetch(`${baseUrl}/app/shares/${token}`, {
      headers: { 'X-Client-Type': 'og-renderer' },
      next: { revalidate: 300 },
    });
    if (!response.ok) return null;
    const json = (await response.json()) as { success?: boolean; data?: PublicShareResponse };
    return json.success && json.data ? json.data : null;
  } catch {
    return null;
  }
}
