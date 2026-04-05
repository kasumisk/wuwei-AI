import { TimestampTool } from '@/page-components/tools/timestamp-tool';
import { generateToolMetadata, ToolJsonLd } from '@/lib/seo/tool-seo';

export async function generateMetadata() {
  return generateToolMetadata('timestamp');
}

export default function TimestampPage() {
  return (
    <div className="container mx-auto py-8 px-4">
      <ToolJsonLd toolSlug="timestamp" />
      <TimestampTool />
    </div>
  );
}
