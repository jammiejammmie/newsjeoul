// updated
// netlify/functions/fetch-comparisons-kr.js
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const RSS_FEEDS = {
  conservative: [
    { name: '조선일보', url: 'https://www.chosun.com/arc/outboundfeeds/rss/category/politics/?outputType=xml' },
  ],
  liberal: [
    { name: '한겨레', url: 'https://www.hani.co.kr/rss/' },
    { name: '경향신문', url: 'https://www.khan.co.kr/rss/rssdata/total_news.xml' },
  ]
};

const POLITICS_KEYWORDS = ['대통령', '국회', '정부', '여당', '야당', '민주당', '국민의힘', '선거', '장관', '총리', '정책', '법안', '의원', '외교', '안보', '복지', '세금', '예산', '개혁', '탄핵', '지지율', '여론', '공약'];
const SPORTS_KEYWORDS = ['메이저리그', '야구', '축구', '농구', '골프', '올림픽', '월드컵', 'MLB', 'NBA', 'K리그', '득점', '홈런', '시구', '경기장', '코치', '선수단'];

function isPolitical(title, desc) {
  const text = title + ' ' + (desc || '');
  if (SPORTS_KEYWORDS.some(kw => text.includes(kw))) return false;
  return POLITICS_KEYWORDS.some(kw => text.includes(kw));
}

async function fetchRSS(url, sourceName) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NewsJeoul/1.0)' },
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) { console.error(`RSS HTTP ${res.status}: ${url}`); return []; }
    const xml = await res.text();
    const items = [];
    const matches = xml.matchAll(/<item>([\s\S]*?)<\/item>/g);
    for (const match of matches) {
      const item = match[1];
      const titleMatch = item.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/);
      const linkMatch = item.match(/<link>(https?:\/\/[^<\s]+)/);
      const descMatch = item.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/);
      const title = (titleMatch?.[1] || '').replace(/<[^>]+>/g, '').replace(/&amp;/g,'&').trim();
      const desc = (descMatch?.[1] || '').replace(/<[^>]+>/g, '').substring(0, 300).trim();
      if (title && title.length > 5) {
        items.push({ title, link: (linkMatch?.[1] || '').trim(), description: desc });
      }
      if (items.length >= 10) break;
    }
    console.log(`${sourceName} RSS: ${items.length}개`);
    return items;
  } catch(e) {
    console.error(`RSS 오류 (${sourceName}):`, e.message);
    return [];
  }
}

async function analyzeWithClaude(conArticle, libArticle, conSource, libSource) {
  const prompt = `당신은 한국 뉴스 미디어 편향을 분석하는 전문가입니다.

보수 매체 (${conSource}): "${conArticle.title}"
${conArticle.description}

진보 매체 (${libSource}): "${libArticle.title}"
${libArticle.description}

두 기사가 같은 사건이나 주제를 다루고 있나요? 같다면 비교 분석을 제공하세요. 다르다면 {"same_topic": false}를 반환하세요.

반드시 유효한 JSON만 반환하세요 (마크다운, 백틱 없이):
{
  "same_topic": true,
  "topic": "중립적인 주제 설명 (최대 60자)",
  "category": "정치|경제|사회|외교|선거|복지|노동|환경",
  "conservative_summary": "보수 관점 중립 요약 (최대 150자)",
  "liberal_summary": "진보 관점 중립 요약 (최대 150자)",
  "ai_analysis": "프레이밍의 핵심 차이점 1-2문장 (최대 180자)",
  "election_related": true또는false
}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error('Claude API 오류: ' + (err.error?.message || res.status));
  }
  const data = await res.json();
  if (!data.content?.[0]?.text) throw new Error('Claude 응답 없음');
  const text = data.content[0].text.replace(/```json|```/g, '').trim();
  return JSON.parse(text);
}

exports.handler = async function(event, context) {
  console.log('뉴스저울 비교 시작...');

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, x-admin-key',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  if (event.httpMethod === 'GET' || event.httpMethod === 'POST') {
    const adminKey = event.headers?.['x-admin-key'] || event.queryStringParameters?.key;
    if (adminKey !== process.env.ADMIN_KEY) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: '인증 실패' }) };
    }
  }

  try {
    const force = event.queryStringParameters?.force === 'true';
    const today = new Date().toISOString().split('T')[0];
    const { data: existing } = await supabase
      .from('comparisons_kr')
      .select('id')
      .gte('created_at', today + 'T00:00:00Z')
      .limit(1);

    if (!force && existing && existing.length >= 5) {
      return { statusCode: 200, headers, body: JSON.stringify({ message: '오늘 비교 이미 충분합니다' }) };
    }

    const saved = [];
    const usedConArticles = new Set();
    const usedLibArticles = new Set();

    for (const conFeed of RSS_FEEDS.conservative) {
      if (saved.length >= 1) break;

      const conArticles = await fetchRSS(conFeed.url, conFeed.name);
      if (!conArticles.length) continue;

      // 정치 기사 최대 3개 시도
      const politicalArticles = conArticles.filter(a => isPolitical(a.title, a.description)).slice(0, 3);
      console.log(`정치 기사 ${politicalArticles.length}개 발견`);
      if (!politicalArticles.length) continue;

      let matched = false;
      for (const conArticle of politicalArticles) {
        if (matched || saved.length >= 1) break;
        const conKey = conFeed.name + conArticle.title.substring(0, 20);
        if (usedConArticles.has(conKey)) continue;

        for (const libFeed of RSS_FEEDS.liberal) {
          if (matched || saved.length >= 1) break;

          const libArticles = await fetchRSS(libFeed.url, libFeed.name);
          if (!libArticles.length) continue;

          const libPolitical = libArticles.filter(a => isPolitical(a.title, a.description)).slice(0, 3);

          for (const libArticle of libPolitical) {
            if (matched) break;
            const libKey = libFeed.name + libArticle.title.substring(0, 20);
            if (usedLibArticles.has(libKey)) continue;

            try {
              console.log(`비교: "${conArticle.title.substring(0,25)}" vs "${libArticle.title.substring(0,25)}"`);
              const analysis = await analyzeWithClaude(conArticle, libArticle, conFeed.name, libFeed.name);

              if (analysis && analysis.same_topic) {
                console.log('매칭!', analysis.topic);
                const { error } = await supabase.from('comparisons_kr').insert({
                  topic: analysis.topic,
                  category: analysis.category,
                  conservative_source: conFeed.name,
                  conservative_summary: analysis.conservative_summary,
                  conservative_url: conArticle.link,
                  liberal_source: libFeed.name,
                  liberal_summary: analysis.liberal_summary,
                  liberal_url: libArticle.link,
                  ai_analysis: analysis.ai_analysis,
                  election_related: analysis.election_related || false
                });
                if (!error) {
                  saved.push(analysis.topic);
                  usedConArticles.add(conKey);
                  usedLibArticles.add(libKey);
                  matched = true;
                } else console.error('Supabase 오류:', error.message);
              }
              await new Promise(r => setTimeout(r, 80));
            } catch(e) {
              console.error('분석 오류:', e.message);
            }
          }
        }
      }
    }

    console.log('저장 완료:', saved.length, saved);
    return { statusCode: 200, headers, body: JSON.stringify({ message: '완료', saved: saved.length, topics: saved }) };

  } catch(e) {
    console.error('치명적 오류:', e.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
