/**
 * Web search used by the research nodes.
 *
 * Uses Tavily when TAVILY_API_KEY is set (free tier at tavily.com). Otherwise
 * falls back to the Wikipedia search API, which needs no key. Both return the
 * same shape: { title, url, snippet }.
 */

import { tavily } from '@tavily/core';

export async function search(query, maxResults = 3) {
  if (process.env.TAVILY_API_KEY) {
    return searchTavily(query, maxResults);
  }
  return searchWikipedia(query, maxResults);
}

async function searchTavily(query, maxResults) {
  const client = tavily({ apiKey: process.env.TAVILY_API_KEY });
  const response = await client.search(query, {
    maxResults,
    searchDepth: 'basic',
  });

  return (response.results ?? []).map(function (r) {
    return { title: r.title ?? '', url: r.url ?? '', snippet: r.content ?? '' };
  });
}

async function searchWikipedia(query, maxResults) {
  const params = new URLSearchParams({
    action: 'query',
    list: 'search',
    format: 'json',
    srlimit: String(maxResults),
    srsearch: query,
  });
  const response = await fetch(`https://en.wikipedia.org/w/api.php?${params}`, {
    headers: { 'User-Agent': 'langgraph-essay-agent-js/1.1 (educational project)' },
  });
  if (!response.ok) {
    throw new Error(`Wikipedia search failed: HTTP ${response.status}`);
  }

  const data = await response.json();
  return (data.query?.search ?? []).map(function (r) {
    return {
      title: r.title,
      url: `https://en.wikipedia.org/wiki/${encodeURIComponent(r.title.replace(/ /g, '_'))}`,
      snippet: r.snippet.replace(/<[^>]+>/g, '').replace(/&quot;/g, '"'),
    };
  });
}
