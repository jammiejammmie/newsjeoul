// updated v3
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

exports.handler = async function(event) {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod) {
    const adminKey = event.headers?.['x-admin-key'] || event.queryStringParameters?.key;
    if (adminKey !== process.env.ADMIN_KEY) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  try {
    // 1단계: 오늘 뉴스 검색
    const searchResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1000,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: [{ role: 'user', content: '오늘 한국 주요 뉴스 5개 제목만 알려줘. 정치 경제 사회 관련으로.' }]
      })
    });

    const searchData = await searchResponse.json();
    const searchText = searchData.content.filter(b => b.type === 'text').map(b => b.text).join('');

    // 2단계: 뉴스를 바탕으로 보수/진보 시각 분석
    const analyzeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 3000,
        messages: [{
          role: 'user',
          content: `다음 오늘의 뉴스들을 바탕으로, 조선일보(보수)와 한겨레(진보)가 각 사안을 어떻게 다르게 보도할지 분석해서 JSON 배열만 반환해라.

오늘 뉴스:
${searchText}

반드시 아래 형식의 JSON 배열만 반환. 설명 없이 JSON만.

[{"title":"사건제목","category":"정치","conservative_outlet":"조선일보","conservative_headline":"보수적 헤드라인","conservative_summary":"보수 관점 요약","liberal_outlet":"한겨레","liberal_headline":"진보적 헤드라인","liberal_summary":"진보 관점 요약","bias_score":65}]

5개 항목. category는 정치/경제/사회/국제. bias_score는 0~100.`
        }]
      })
    });

    if (!analyzeResponse.ok) throw new Error('Claude 분석 에러');
    const analyzeData = await analyzeResponse.json();
    const text = analyzeData.content.filter(b => b.type === 'text').map(b => b.text).join('');

    const match = text.match(/\[[\s\S]*\]/);
    if (!match) throw new Error('JSON 없음: ' + text.substring(0, 200));
    const items = JSON.parse(match[0]);

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    await supabaseDelete('news_kr', todayStart.toISOString());
    await supabaseInsert('news_kr', items);

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, saved: items.length, topics: items.map(i => i.title) }) };
  } catch(e) {
    console.error(e.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
