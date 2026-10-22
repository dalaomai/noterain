function sanitizeSvg(svg) {
  return svg
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
    .replace(/\s(?:on\w+|href|xlink:href)\s*=\s*(["'])\s*(?:javascript:|https?:|\/\/)[\s\S]*?\1/gi, '');
}

function sanitizeText(value, maxLength = 256) {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, maxLength)
    : '';
}

export function validateCollectedScore(result, expectedScoreId) {
  if (result?.source?.scoreId !== expectedScoreId) throw new Error('SCORE_ID_MISMATCH');
  const hasReconstructionSources =
    typeof result?.midiBase64 === 'string' &&
    /^[A-Za-z0-9+/]+=*$/.test(result.midiBase64) &&
    Array.isArray(result.pages) &&
    result.pages.length >= 1 &&
    result.pages.length <= 100 &&
    result.pages.every((page) => typeof page === 'string' && /^\s*<svg\b/i.test(page));
  if (
    result?.source?.provider !== 'musescore' ||
    typeof result.title !== 'string' ||
    !result.title.trim() ||
    !hasReconstructionSources
  ) {
    throw new Error('INVALID_IMPORT_RESULT');
  }
  return {
    ...result,
    metadata: {
      subtitle: sanitizeText(result.metadata?.subtitle),
      composer: sanitizeText(result.metadata?.composer),
      arranger: sanitizeText(result.metadata?.arranger),
    },
    pages: result.pages?.map(sanitizeSvg),
  };
}