function normalizeMapArticle(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function lineContainsExactArticle(line, article) {
  return (String(line || '').toUpperCase().match(/[A-Z0-9]+/g) || [])
    .some(token => normalizeMapArticle(token) === article);
}

function lookupArticleInMap(cells, unaddressed, article) {
  const locations = [];
  for (const [street, shelves] of Object.entries(cells || {})) {
    if (!/^S[1-5]$/.test(street) || !shelves || typeof shelves !== 'object') continue;
    for (const [shelf, cellRows] of Object.entries(shelves)) {
      if (!/^[ABCDE FGHJK]$/.test(shelf.replace(' ', '')) || !cellRows || typeof cellRows !== 'object') continue;
      for (const [cell, rawValue] of Object.entries(cellRows)) {
        if (!/^([1-9]|10)$/.test(cell) || typeof rawValue !== 'string' || !rawValue.trim()) continue;
        const matched = rawValue.split(/\r?\n/).some(line => lineContainsExactArticle(line, article));
        if (matched) locations.push({ address: street + '-' + shelf + '-' + cell, street, shelf, cell });
      }
    }
  }

  const isUnaddressed = Object.values(unaddressed || {}).some(item =>
    normalizeMapArticle(item?.article) === article
  );
  return { article, locations, unaddressed: isUnaddressed };
}


module.exports = { normalizeMapArticle, lineContainsExactArticle, lookupArticleInMap };
