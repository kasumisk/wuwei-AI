import { JsonFormatter } from '@/page-components/tools/json-formatter';
import { generateToolMetadata, ToolJsonLd } from '@/lib/seo/tool-seo';

export async function generateMetadata() {
  return generateToolMetadata('json-formatter');
}

export default function JsonFormatterPage() {
  return (
    <div className="container mx-auto py-8 px-4">
      <ToolJsonLd toolSlug="json-formatter" />
      <JsonFormatter />
    </div>
  );
}
