import ts from "typescript";

export interface SourceComment {
  readonly text: string;
  readonly line: number;
  /** True when no code precedes the comment on its line. */
  readonly ownLine: boolean;
}

/**
 * Collects every real comment (never text inside strings) by asking each token for its
 * leading and trailing trivia.
 */
export function collectComments(sourceFile: ts.SourceFile): SourceComment[] {
  const text = sourceFile.text;
  const seen = new Set<number>();
  const comments: SourceComment[] = [];

  const add = (ranges: readonly ts.CommentRange[] | undefined): void => {
    for (const range of ranges ?? []) {
      if (seen.has(range.pos)) continue;
      seen.add(range.pos);
      const start = sourceFile.getLineAndCharacterOfPosition(range.pos);
      const lineStart = sourceFile.getPositionOfLineAndCharacter(start.line, 0);
      comments.push({
        text: text.slice(range.pos, range.end),
        line: start.line + 1,
        ownLine: text.slice(lineStart, range.pos).trim() === "",
      });
    }
  };

  const visit = (node: ts.Node): void => {
    add(ts.getLeadingCommentRanges(text, node.pos));
    add(ts.getTrailingCommentRanges(text, node.end));
    for (const child of node.getChildren(sourceFile)) visit(child);
  };
  visit(sourceFile);
  return comments;
}
