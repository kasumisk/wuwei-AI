import { VideoCompressor } from '@/page-components/tools/video-compressor';
import { generateToolMetadata, ToolJsonLd } from '@/lib/seo/tool-seo';

export async function generateMetadata() {
  return generateToolMetadata('video-compressor');
}

export default function VideoCompressorPage() {
  return (
    <div className="container mx-auto py-8 px-4">
      <ToolJsonLd toolSlug="video-compressor" />
      <VideoCompressor />
    </div>
  );
}
