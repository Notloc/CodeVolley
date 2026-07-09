import { createContext, useContext, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";

// Thread references: agents naturally mention threads by id ("t-3") in
// comments and notes. Rather than banning that, bare ids become links that
// take the reader to the thread — the review view supplies the navigation
// via this context (a stable value, so it doesn't defeat render isolation).
export interface ThreadRefHandler {
  open: (threadId: string) => void;
  titleFor: (threadId: string) => string | undefined;
}
export const ThreadRefContext = createContext<ThreadRefHandler | null>(null);

const THREAD_ID_SPLIT = /(\bt-\d+\b)/;
const THREAD_ID_EXACT = /^t-\d+$/;

function ThreadRefLink({ id }: { id: string }) {
  const refs = useContext(ThreadRefContext);
  const title = refs?.titleFor(id);
  if (!refs || !title) return <>{id}</>; // unknown id (or no review context): leave as text
  return (
    <a
      href={`#${id}`}
      className="thread-ref"
      title={title}
      onClick={(e) => {
        e.preventDefault();
        refs.open(id);
      }}
    >
      {id}
    </a>
  );
}

// Linkifies bare thread ids in a plain string — for non-Markdown spots like
// the progress ticker.
export function ThreadRefText({ children }: { children: string }) {
  return (
    <>
      {children.split(THREAD_ID_SPLIT).map((part, i) =>
        THREAD_ID_EXACT.test(part) ? <ThreadRefLink key={i} id={part} /> : <span key={i}>{part}</span>,
      )}
    </>
  );
}

interface MdastNode {
  type: string;
  value?: string;
  url?: string;
  children?: MdastNode[];
}

// remark plugin: split text nodes on thread ids and emit link nodes with a
// "#thread:" pseudo-href, resolved by the `a` component override below.
// Text inside code/inlineCode lives on `value` of childless nodes, so code
// stays literal; text already inside a link is left alone.
function remarkThreadRefs() {
  return (tree: MdastNode) => {
    visit(tree);
  };
}

function visit(node: MdastNode) {
  if (!node.children) return;
  if (node.type === "link" || node.type === "linkReference") return;
  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i];
    if (child.type === "text" && child.value && THREAD_ID_SPLIT.test(child.value)) {
      const parts: MdastNode[] = child.value
        .split(THREAD_ID_SPLIT)
        .filter((s) => s.length > 0)
        .map((s) =>
          THREAD_ID_EXACT.test(s)
            ? { type: "link", url: `#thread:${s}`, children: [{ type: "text", value: s }] }
            : { type: "text", value: s },
        );
      node.children.splice(i, 1, ...parts);
      i += parts.length - 1;
    } else {
      visit(child);
    }
  }
}

// Renders comment text as Markdown. react-markdown produces React elements
// (no dangerouslySetInnerHTML) and ignores raw HTML by default, so untrusted
// comment bodies can't inject markup; remark-gfm adds tables/strikethrough/
// task-lists/autolinks, remark-breaks keeps single newlines as line breaks.
export function Markdown({ children }: { children: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks, remarkThreadRefs]}
        components={{
          a: ({ href, children: kids, ...rest }) => {
            if (href?.startsWith("#thread:")) {
              return <ThreadRefLink id={href.slice("#thread:".length)} />;
            }
            return (
              <a href={href} {...rest}>
                {kids as ReactNode}
              </a>
            );
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
