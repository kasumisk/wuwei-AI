import { ImageCompressor } from '@/page-components/tools/image-compressor';
import { generateToolMetadata, ToolJsonLd } from '@/lib/seo/tool-seo';

export async function generateMetadata() {
  return generateToolMetadata('image-compressor');
}

export default function ImageCompressorPage() {
  return (
    <div className="container mx-auto py-8 px-4">
      <ToolJsonLd toolSlug="image-compressor" />
      <ImageCompressor />
    </div>
  );
}
