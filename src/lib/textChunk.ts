const MAX_CHUNK_LENGTH = 250;

export interface TextChunk {
  text: string;
  index: number;
  total: number;
}

export function splitTextIntoChunks(input: string): TextChunk[] {
  const text = input.trim();
  if (!text) return [];

  // Split on natural boundaries: newlines first, then sentences, then words
  const lines = text.split(/\n+/).filter((l) => l.trim().length > 0);

  const segments: string[] = [];
  for (const line of lines) {
    if (line.length <= MAX_CHUNK_LENGTH) {
      segments.push(line.trim());
    } else {
      // Split long lines on sentence boundaries
      const sentences = line.split(/(?<=[.!?;:])\s+/);
      let current = '';
      for (const sentence of sentences) {
        if (sentence.length > MAX_CHUNK_LENGTH) {
          // Flush current
          if (current) {
            segments.push(current.trim());
            current = '';
          }
          // Split very long sentence on words
          const words = sentence.split(/\s+/);
          let wordChunk = '';
          for (const word of words) {
            if ((wordChunk + ' ' + word).trim().length > MAX_CHUNK_LENGTH) {
              if (wordChunk) segments.push(wordChunk.trim());
              wordChunk = word;
            } else {
              wordChunk = (wordChunk + ' ' + word).trim();
            }
          }
          if (wordChunk) segments.push(wordChunk.trim());
        } else if ((current + ' ' + sentence).trim().length > MAX_CHUNK_LENGTH) {
          if (current) segments.push(current.trim());
          current = sentence;
        } else {
          current = (current + ' ' + sentence).trim();
        }
      }
      if (current) segments.push(current.trim());
    }
  }

  return segments.map((t, i) => ({
    text: t,
    index: i,
    total: segments.length,
  }));
}
