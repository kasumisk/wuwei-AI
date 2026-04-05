import { Base64Tool } from '@/page-components/tools/base64-tool';
import { generateToolMetadata, ToolJsonLd } from '@/lib/seo/tool-seo';

export async function generateMetadata() {
  return generateToolMetadata('base64');
}

export default function Base64Page() {
  return (
    <div className="container mx-auto py-8 px-4">
      <ToolJsonLd toolSlug="base64" />
      <Base64Tool />
    </div>
  );
}
