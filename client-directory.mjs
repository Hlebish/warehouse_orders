export function searchClients(clients, text, maxResults = 8) {
  const query = String(text || '').trim().toLocaleLowerCase('ru');
  if (!query) return [];
  return (Array.isArray(clients) ? clients : [])
    .filter(client => String(client.name || '').toLocaleLowerCase('ru').includes(query)
      || String(client.phone || '').toLocaleLowerCase('ru').includes(query))
    .slice(0, maxResults);
}

export function searchProducts(products, text, maxResults = 8) {
  const query = String(text || '').trim().toLocaleLowerCase('ru');
  if (query.length < 2) return [];
  const exact = [], starts = [], other = [];
  for (const product of Array.isArray(products) ? products : []) {
    const article = String(product.a || '').toLocaleLowerCase('ru');
    const aliases = String(product.o || '').split(',').map(value => value.trim().toLocaleLowerCase('ru'));
    if (article === query || aliases.includes(query)) exact.push(product);
    else if (article.startsWith(query) || aliases.some(value => value.startsWith(query))) starts.push(product);
    else if (String(product.n || '').toLocaleLowerCase('ru').includes(query)
      || String(product.b || '').toLocaleLowerCase('ru').includes(query)) other.push(product);
  }
  return [...exact, ...starts, ...other].slice(0, maxResults);
}
