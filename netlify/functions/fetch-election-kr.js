// netlify/functions/fetch-election-kr.js
// 6월 3일 지방선거 특집 - 후보 관련 보도 논조 자동 분석

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const ELECTION_FEEDS = [
  { name: '조선일보', url: 'https://www.chosun.com/arc/outboundfeeds/rss/category/politics/?outputType=xml', lean: 'conservative' },
  { name: '동아일보', url: 'https://rss.donga.com/politics.xml', lean: 'conservative' },
  { name: '한겨레', url: 'https://www.hani.co.kr/rss/', lean: 'liberal' },
  { name: '경향신문', url: 'https://www.khan.co.kr/rss/rssdata/total_news.xml', lean: 'liberal' },
];

const ELECTION_KEYWORDS = ['선거', '후보', '지방선거', '시장', '도지사', '구청장', '당선', '출마', '공약', '여론조사', '지지율'];

async function fetchRSS(url, sourceName) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NewsJeoul/1.0)' },
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) return [];
    const xml = await res.text();
    const items = [];
    const matches = xml.matchAll(/<item>([\s\S]*?)<\/item>/g);
    for (const match of matches) {
      const item = match[1];
      const titleMatch = item.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/);
      const linkMatch = item.match(/<link>(https?:\/\/[^<\s]+)/);
      const descMatch = item.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/);
      const title = (titleMatch?.[1] || '').replace(/<[^>]+>/g, '').replace(/&amp;/g,'&').trim();
      const desc = (descMatch?.[1] || '').replace(/<[^>]+>/g, '').substring(0, 400).trim();
      if (title && title.length > 5) {
        // 선거 관련 기사만 필터링
        const isElectionRelated = ELECTION_KEYWORDS.some(kw => title.includes(kw) || desc.includes(kw));
        if (isElectionRelated) {
          items.push({ title, link: (linkMatch?.[1] || '').trim(), description: desc });
        }
      }
      if (items.length >= 8) break;
    }
    console.log(`${sourceName} 선거 기사: ${items.length}개`);
    return items;
  } catch(e) {
    console.error(`RSS 오류 (${sourceName}):`, e.message);
    return [];
  }
}

async function analyzeElectionCoverage(conArticle, libArticle, conSource, libSource) {
  const prompt = `당신은 한국 선거 보도 편향을 분석하는 전문가입니다.

보수 매체 (${conSource}): "${conArticle.title}"
${conArticle.description}

진보 매체 (${libSource}): "${libArticle.title}"
${libArticle.description}

두 기사가 같은 선거 관련 사건을 다루고 있나요?

반드시 유효한 JSON만 반환하세요 (마크다운, 백틱 없이):
{
  "same_topic": true또는false,
  "topic": "중립적인 주제 설명 (최대 60자)",
  "category": "선거",
  "conservative_summary": "보수 관점 요약 (최대 150자)",
  "liberal_summary": "진보 관점 요약 (최대 150자)",
  "ai_analysis": "보도 논조 차이 핵심 (최대 180자)",
  "election_related": true,
  "bias_score": {
    "conservative": -2에서2사이정수,
    "liberal": -2에서2사이정수
  }
}

bias_score: -2(매우부정적) -1(부정적) 0(중립) 1(긍정적) 2(매우긍정적)`;

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
  console.log('선거 특집 분석 시작...');

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
      .eq('election_related', true)
      .gte('created_at', today + 'T00:00:00Z')
      .limit(1);

    if (!force && existing && existing.length >= 3) {
      return { statusCode: 200, headers, body: JSON.stringify({ message: '오늘 선거 분석 이미 충분합니다' }) };
    }

    const conFeeds = ELECTION_FEEDS.filter(f => f.lean === 'conservative');
    const libFeeds = ELECTION_FEEDS.filter(f => f.lean === 'liberal');
    const saved = [];

    // 각 보수 신문 1개 기사만 사용 — 타임아웃 방지
    for (const conFeed of conFeeds) {
      if (saved.length >= 2) break;

      const conArticles = await fetchRSS(conFeed.url, conFeed.name);
      if (!conArticles.length) continue;

      const conArticle = conArticles[0]; // 첫 번째 기사만
      let matched = false;

      for (const libFeed of libFeeds) {
        if (matched || saved.length >= 2) break;

        const libArticles = await fetchRSS(libFeed.url, libFeed.name);
        if (!libArticles.length) continue;

        const libArticle = libArticles[0]; // 첫 번째 기사만

        try {
          console.log(`선거 비교: "${conArticle.title.substring(0,30)}" vs "${libArticle.title.substring(0,30)}"`);
          const analysis = await analyzeElectionCoverage(conArticle, libArticle, conFeed.name, libFeed.name);
          if (analysis && analysis.same_topic) {
            const { error } = await supabase.from('comparisons_kr').insert({
              topic: analysis.topic,
              category: '선거',
              conservative_source: conFeed.name,
              conservative_summary: analysis.conservative_summary,
              conservative_url: conArticle.link,
              liberal_source: libFeed.name,
              liberal_summary: analysis.liberal_summary,
              liberal_url: libArticle.link,
              ai_analysis: analysis.ai_analysis,
              election_related: true
            });
            if (!error) { saved.push(analysis.topic); matched = true; }
            else console.error('Supabase 오류:', error.message);
          }
          await new Promise(r => setTimeout(r, 100));
        } catch(e) {
          console.error('분석 오류:', e.message);
        }
      }
    }

    console.log('선거 분석 저장:', saved.length, saved);
    return { statusCode: 200, headers, body: JSON.stringify({ message: '완료', saved: saved.length, topics: saved }) };

  } catch(e) {
    console.error('치명적 오류:', e.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
