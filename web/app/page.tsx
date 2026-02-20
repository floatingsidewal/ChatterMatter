import { UploadArea } from "@/components/UploadArea";

export default function HomePage() {
  return (
    <div className="px-6 py-16">
      <div className="max-w-2xl mx-auto text-center mb-12">
        <h1 className="text-3xl font-bold text-gray-900 mb-3">
          Review Markdown documents
        </h1>
        <p className="text-gray-600 text-lg">
          Upload a Markdown file, highlight text to comment, and get AI-powered
          feedback — all in your browser.
        </p>
      </div>
      <UploadArea />
    </div>
  );
}
