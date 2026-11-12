function normalizeBuybackArticle(value) {
  // Normalize harmless separators but keep the whole code: truncating APxx
  // codes at their first digits can merge distinct product variants.
  const lookalikes = { А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', У: 'Y', Х: 'X', І: 'I', Ј: 'J', Ѕ: 'S' };
  return String(value || '').normalize('NFKC').trim().toUpperCase()
    .replace(/[АВЕКМНОРСТУХІЈЅ]/g, character => lookalikes[character] || character)
    .replace(/[^A-Z0-9]/g, '');
}

// Order imports append a description to the SKU. Only match a complete prefix
// at a whitespace boundary against an actual inventory SKU, never a substring.
function resolveBuybackArticle(value, knownArticles) {
  const full = normalizeBuybackArticle(value);
  if (!knownArticles || knownArticles.has(full)) return full;
  const parts = String(value || '').normalize('NFKC').trim().split(/\s+/);
  for (let end = parts.length - 1; end > 0; end--) {
    const prefix = normalizeBuybackArticle(parts.slice(0, end).join(' '));
    if (knownArticles.has(prefix)) return prefix;
  }
  return full;
}

function buybackArticleQuantities(articles, knownArticles) {
  const result = new Map();
  for (const line of Array.isArray(articles) ? articles : []) {
    const article = resolveBuybackArticle(line?.article, knownArticles);
    const quantity = Math.max(1, Math.floor(Number(line?.quantity) || 1));
    if (article) result.set(article, (result.get(article) || 0) + quantity);
  }
  return result;
}

// Defect decisions retain the original order line for history, but a removed
// line must never consume inventory when the rest of the order is shipped.
function buybackShippableArticles(articles, entries) {
  const removed = (Array.isArray(entries) ? entries : []).filter(entry => entry.kind === 'defect' && entry.decision === 'Удалена из заказа');
  return (Array.isArray(articles) ? articles : []).filter((line, index) => !removed.some(entry =>
    Number.isInteger(entry.articleIndex) ? entry.articleIndex === index : entry.article === line.article
  ));
}

module.exports = { normalizeBuybackArticle, resolveBuybackArticle, buybackArticleQuantities, buybackShippableArticles };
