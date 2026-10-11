import ReactMarkdown, { type Components } from 'react-markdown';

const heading = 'mt-3 mb-1 text-[13px] font-black tracking-wide text-tint-ink uppercase first:mt-0';

/** Claude's answers: Markdown without raw HTML; links shown as text so nothing navigates away (spec §5.3). */
const components: Components = {
  h1: ({ node: _node, ...props }) => <h3 className={heading} {...props} />,
  h2: ({ node: _node, ...props }) => <h3 className={heading} {...props} />,
  h3: ({ node: _node, ...props }) => <h3 className={heading} {...props} />,
  h4: ({ node: _node, ...props }) => <h4 className="mt-2 mb-1 text-[14px] font-extrabold" {...props} />,
  p: ({ node: _node, ...props }) => <p className="my-1.5 text-[14px] leading-relaxed" {...props} />,
  ul: ({ node: _node, ...props }) => <ul className="my-1.5 list-disc space-y-1 pl-5 text-[14px]" {...props} />,
  ol: ({ node: _node, ...props }) => <ol className="my-1.5 list-decimal space-y-1 pl-5 text-[14px]" {...props} />,
  li: ({ node: _node, ...props }) => <li className="leading-relaxed" {...props} />,
  strong: ({ node: _node, ...props }) => <strong className="font-extrabold" {...props} />,
  code: ({ node: _node, ...props }) => <code className="rounded bg-soft px-1 py-0.5 text-[13px]" {...props} />,
  blockquote: ({ node: _node, ...props }) => <blockquote className="my-1.5 border-l-4 border-line pl-3 text-mute" {...props} />,
  a: ({ children }) => <span className="underline decoration-dotted">{children}</span>,
  img: () => null,
};

export function Markdown({ children }: { children: string }) {
  return (
    <div className="break-words">
      <ReactMarkdown skipHtml components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
