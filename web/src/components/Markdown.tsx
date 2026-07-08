import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";

// Renders comment text as Markdown. react-markdown produces React elements
// (no dangerouslySetInnerHTML) and ignores raw HTML by default, so untrusted
// comment bodies can't inject markup; remark-gfm adds tables/strikethrough/
// task-lists/autolinks, remark-breaks keeps single newlines as line breaks.
export function Markdown({ children }: { children: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>{children}</ReactMarkdown>
    </div>
  );
}
