function normalizeMapArticle(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function lineContainsExactArticle(line, normalizedArticle) {
  const tokens = String(line || '').toUpperCase().match(/[A-Z0-9]+/g) || [];
  for (let start = 0; start < tokens.length; start++) {
    let combined = '';
    for (let end = start; end < Math.min(tokens.length, start + 5); end++) {
      combined += normalizeMapArticle(tokens[end]);
      if (combined === article) return true;
      if (combined.length >= article.length) break;
    }
  }
  return false;
}

function lookupArticleInMap(cells, unaddressed, article) {
  const normalizedArticle = normalizeMapArticle(article);
  const locations = [];
  for (const [street, shelves] of Object.entries(cells || {})) {
    if (!/^S[1-5]$/.test(street) || !shelves || typeof shelves !== 'object') continue;
    for (const [shelf, cellRows] of Object.entries(shelves)) {
      if (!/^[A-EFGHJK]$/.test(shelf) || !cellRows || typeof cellRows !== 'object') continue;
      for (const [cell, rawValue] of Object.entries(cellRows)) {
        if (!/^([1-9]|10)$/.test(cell) || typeof rawValue !== 'string' || !rawValue.trim()) continue;
        const matched = rawValue.split(/\r?\n/).some(line => lineContainsExactArticle(line, article));
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
