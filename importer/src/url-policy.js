const SCORE_PATH = /^\/user\/\d+\/scores\/(\d+)\/?$/;

export function parsePublicScoreUrl(input) {
  let url;
  try {
    url = new URL(input);
  } catch {
    throw new Error('INVALID_SCORE_URL');
  }
  const match = url.pathname.match(SCORE_PATH);
  if (url.protocol !== 'https:' || url.hostname !== 'musescore.com' || !match) {
    throw new Error('INVALID_SCORE_URL');
  }
  url.search = '';
  url.hash = '';
  return { url: url.toString(), scoreId: Number(match[1]) };
}