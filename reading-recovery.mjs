import {words} from './reading-follow.mjs';

// Index adjacent passages together so a spoken phrase can cross their boundary.
export function createRecoveryMatcher(blocks, language) {
  const tokens = [];
  const passage = [];
  blocks.forEach((block, index) => {
    for (const token of words(block[language] || '')) {
      tokens.push(token);
      passage.push(index);
    }
  });
  return function locate(transcript, current = 0) {
    const spoken = words(transcript).slice(-12);
    for (let length = spoken.length; length >= 4; length--) {
      const suffix = spoken.slice(-length);
      const matches = [];
      for (let start = 0; start <= tokens.length - length; start++) {
        if (suffix.every((word, offset) => word === tokens[start + offset])) {
          matches.push({start, index: passage[start + length - 1]});
        }
      }
      // Multiple occurrences remain ambiguous even when one is near the cursor.
      if (matches.length !== 1) continue;
      const match = matches[0];
      const nearby = match.index >= current && match.index <= current + 4;
      if (length >= (nearby ? 4 : 8)) return match.index;
    }
    return null;
  };
}
