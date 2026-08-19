import { createHash } from 'node:crypto';

/** The content fingerprint used by both source imports and generated documents. */
export type Fingerprint = {
  contentSha256: string;
  normalizedSha256: string;
  shingles: string[];
  wordCount: number;
};

export function fingerprintOf(content: string): Fingerprint {
  const normalized = content.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const words = normalized ? normalized.split(/\s+/) : [];
  const shingles = [3, 5].flatMap((size) => {
    const values: string[] = [];
    for (let index = 0; index <= words.length - size; index += 1) {
      values.push(`${size}:${words.slice(index, index + size).join(' ')}`);
    }
    return values;
  });
  return {
    contentSha256: sha256(content),
    normalizedSha256: sha256(normalized),
    shingles,
    wordCount: words.length,
  };
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
