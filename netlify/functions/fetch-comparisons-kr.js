// updated v6 - Google News RSS
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

async function supabaseDelete(table, gte_date) {
  await fetch(`${SUPABASE_URL}/rest/v1/${table}?created_at=gte.${gte_date}`, {
    method: 'DELETE',
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY, 'Content-Type': 'application/json' }
  });
}

async function supabaseInsert(table, data) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
    body: JSON.stringify(data)
  });
  if (!res.ok) throw new Error('Supabase error: ' + await res.text());
}

async function fetchGoogleNews(outlet) {
  try {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(outlet)}&hl=ko&gl=KR&ceid=KR:ko`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NewsBot/1.0)' },
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) return [];
    const xml = await res.text();
    const items = [];
    const matches = xml.matchAll(/<item>([\s\S]*?)<\/item>/g);
    for (const match of matches) {
      const item = match[1];
      const titleMatch = item.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/);
      const title = (titleMatch?.[1] || '').replace(/<[^>]+>/g, '').trim();
      if (title && title.length > 10) items.push(title);
      if (items.length >= 8) break;
    }
    console.log(`${outlet} 기사: ${items.length}개`);
    return items;
  } catch(e) {
    console.error(`${outlet} RSS 오류:`, e.message);
    return [];
  }
}

async function analyzeWithClaude(conTitles, libTitles) {
  const prompt = `다음은 오늘 조선일보와 한겨레의 주요 기사 제목들이다.

조선일보 기사:
${conTitles.map((t,i) => `${i+1}. ${t}`).join('\n')}

한겨레 기사:
${libTitles.map((t,i) => `${i+1}. ${t}`).join('\n')}

같은 사건/주제를 다르게 보도한 것 5개를 찾아서 반드시 JSON 배열만 반환해라. 설명 금지. 마크다운 금지.

[{"title":"사건 제목","category":"정치","conservative_outlet":"조선일보","conservative_headline":"조선일보 제목","conservative_summary":"조선일보 관점 요약 2문장","liberal_outlet":"한겨레","liberal_headline":"한겨레 제목","liberal_summary":"한겨레 관점 요약 2문장","bias_score":65}]

category는 정치/경제/사회/국제. bias_score는 0~100.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 3000,
      messages: [{ role: 'user', content: prompt }]
    })
  });
  if (!res.ok) throw new Error('Claude 에러: ' + await res.text());
  const data = await res.json();
  const text = data.content.filter(b => b.type === 'text').map(b => b.text).join('');
  console.log('Claude 응답:', text.substring(0, 200));
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) throw new Error('JSON 없음: ' + text.substring(0, 200));
  return JSON.parse(match[0]);
}

exports.handler = async function(event) {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod) {
    const adminKey = event.headers?.['x-admin-key'] || event.queryStringParameters?.key;
    if (adminKey !== process.env.ADMIN_KEY) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  try {
    const [conTitles, libTitles] = await Promise.all([
      fetchGoogleNews('조선일보'),
      fetchGoogleNews('한겨레')
    ]);

    if (!conTitles.length || !libTitles.length) {
      throw new Error(`기사 수집 실패 - 조선일보: ${conTitles.length}개, 한겨레: ${libTitles.length}개`);
    }

    const items = await analyzeWithClaude(conTitles, libTitles);

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    await supabaseDelete('news_kr', todayStart.toISOString());
    await supabaseInsert('news_kr', items);

    console.log('저장 완료:', items.length);
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, saved: items.length, topics: items.map(i => i.title) }) };
  } catch(e) {
    console.error('에러:', e.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
