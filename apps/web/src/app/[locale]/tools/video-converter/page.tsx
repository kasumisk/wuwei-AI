import { VideoConverter } from '@/page-components/tools/video-converter';
import { generateToolMetadata, ToolJsonLd } from '@/lib/seo/tool-seo';

export async function generateMetadata() {
  return generateToolMetadata('video-converter');
}

export default function VideoConverterPage() {
  return (
    <div className="container mx-auto py-8 px-4">
      <ToolJsonLd toolSlug="video-converter" />
      <VideoConverter />
    </div>
  );
}
