function extractApArticles(text) {
  // Match complete AP codes anywhere in a line. A separated four-digit
  // calendar year is description, not part of the preceding numeric code.
  return Array.from(text.matchAll(/(?<![\p{L}\p{N}])A[ \t-]*P[ \t-]*[A-Z][ \t-]*[A-Z][ \t-]*\d+(?:[ \t-]+(?!(?:19|20)\d{2}(?![A-Z0-9]))\d+)*(?:[A-Z][A-Z0-9]*|-[A-Z][A-Z0-9]*|[ \t-]+[A-Z]\d*(?![A-Z0-9]))?/gu), code =>
    code[0].replace(/[^A-Z0-9]/g, ''));
}

function normalizeMapArticle(value) {
  const text = String(value || '').trim().toUpperCase();
  return extractApArticles(text)[0] || text.replace(/[^A-Z0-9]/g, '');
}

function lineContainsExactArticle(line, article) {
  const normalizedArticle = normalizeMapArticle(article);
  if (!normalizedArticle) return false;
  const text = String(line || '').trim().toUpperCase();
  const apCodes = extractApArticles(text);
  if (extractApArticles(normalizedArticle).length) return apCodes.includes(normalizedArticle);
  const tokens = text.match(/[A-Z0-9]+/g) || [];
  for (let start = 0; start < tokens.length; start++) {
    let combined = '';
    for (let end = start; end < Math.min(tokens.length, start + 5); end++) {
      combined += tokens[end];
      if (combined === normalizedArticle) return true;
      if (combined.length >= normalizedArticle.length) break;
    }
  }
  return false;
}

function lookupArticleInMap(cells, unaddressed, article) {
  const normalizedArticle = normalizeMapArticle(article);
  if (!normalizedArticle) return { article, locations: [], unaddressed: false };
  const locations = [];
  for (const [street, shelves] of Object.entries(cells || {})) {
    if (!/^S[1-5]$/.test(street) || !shelves || typeof shelves !== 'object') continue;
    for (const [shelf, cellRows] of Object.entries(shelves)) {
      if (!/^[A-EFGHJK]$/.test(shelf) || !cellRows || typeof cellRows !== 'object') continue;
      for (const [cell, rawValue] of Object.entries(cellRows)) {
        if (!/^([1-9]|10)$/.test(cell) || typeof rawValue !== 'string' || !rawValue.trim()) continue;
        const matched = rawValue.split(/\r?\n/).some(line => {
          // Compare complete article tokens (including codes split by separators).
          // A substring check here would also match a longer neighboring code,
          // such as APHD43070 when looking up APHD4307.
          return lineContainsExactArticle(line, normalizedArticle);
        });
        if (matched) locations.push({ address: street + '-' + shelf + '-' + cell, street, shelf, cell });
      }
    }
  }

  const isUnaddressed = Object.values(unaddressed || {}).some(item =>
    normalizeMapArticle(item?.article) === normalizedArticle
  );
  return { article, locations, unaddressed: isUnaddressed };
}

module.exports = { normalizeMapArticle, lineContainsExactArticle, lookupArticleInMap };
