import katex from "katex";

type MathTextProps = {
  value: string;
  block?: boolean;
  className?: string;
};

const TOKEN_PATTERN = /(\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|\$(?:\\.|[^$])*?\$)/g;

function renderMath(source: string, displayMode: boolean): string {
  return katex.renderToString(source, {
    displayMode,
    throwOnError: false,
    strict: "ignore",
  });
}

export function MathText({ value, block = false, className = "" }: MathTextProps) {
  const parts = value.split(TOKEN_PATTERN).filter(Boolean);
  const Tag = block ? "div" : "span";
  return (
    <Tag className={`math-text ${block ? "is-block" : ""} ${className}`.trim()}>
      {parts.map((part, index) => {
        if (part.startsWith("$$") && part.endsWith("$$")) {
          return <span key={index} className="math-display" dangerouslySetInnerHTML={{ __html: renderMath(part.slice(2, -2), true) }} />;
        }
        if (part.startsWith("\\[") && part.endsWith("\\]")) {
          return <span key={index} className="math-display" dangerouslySetInnerHTML={{ __html: renderMath(part.slice(2, -2), true) }} />;
        }
        if (part.startsWith("\\(") && part.endsWith("\\)")) {
          return <span key={index} dangerouslySetInnerHTML={{ __html: renderMath(part.slice(2, -2), false) }} />;
        }
        if (part.startsWith("$") && part.endsWith("$")) {
          return <span key={index} dangerouslySetInnerHTML={{ __html: renderMath(part.slice(1, -1), false) }} />;
        }
        return <span key={index}>{part.split(/\\\\|\n/).map((line, lineIndex) => <span key={lineIndex}>{lineIndex ? <br /> : null}{line}</span>)}</span>;
      })}
    </Tag>
  );
}
