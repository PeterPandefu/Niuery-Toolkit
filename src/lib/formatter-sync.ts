interface TextToken {
  value: string;
  start: number;
  end: number;
}

const TOKEN_PATTERN = /"(?:\\.|[^"\\])*"|'(?:''|\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|[A-Za-z_$][\w$.-]*|-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g;

function tokenize(text: string): TextToken[] {
  return Array.from(text.matchAll(TOKEN_PATTERN), (match) => ({
    value: match[0],
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
  }));
}

/** 仅把格式化结果中修改过的语义 token 写回原始文本，保留原始排版。 */
export function syncFormatterValuePreservingFormat(
  originalText: string,
  previousFormattedText: string,
  editedFormattedText: string,
): string {
  if (!originalText || previousFormattedText === editedFormattedText) return originalText;

  const previousTokens = tokenize(previousFormattedText);
  const editedTokens = tokenize(editedFormattedText);
  const originalTokens = tokenize(originalText);

  // token 数量变化通常意味着结构被编辑，无法安全映射到原始文本。
  if (previousTokens.length !== editedTokens.length || originalTokens.length !== previousTokens.length) {
    return originalText;
  }

  const replacements = previousTokens.flatMap((token, index) => {
    const editedToken = editedTokens[index];
    const originalToken = originalTokens[index];
    if (!editedToken || !originalToken || token.value === editedToken.value || originalToken.value !== token.value) {
      return [];
    }
    return [{ start: originalToken.start, end: originalToken.end, value: editedToken.value }];
  });

  return replacements
    .sort((a, b) => b.start - a.start)
    .reduce((text, replacement) => (
      text.slice(0, replacement.start) + replacement.value + text.slice(replacement.end)
    ), originalText);
}
