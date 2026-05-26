// updated v5
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
    const today = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4000,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: [{
          role: 'user',
          content: `${today} 한국 뉴스를 검색해서 조선일보와 한겨레가 다르게 보도한 사건 5개를 찾아라. 반드시 JSON 배열만 응답해라. 설명 금지. 마크다운 금지.

[{"title":"이재명 대표 공직선거법 2심 선고","category":"정치","conservative_outlet":"조선일보","conservative_headline":"이재명 2심도 당선무효형…사법리스크 현실화","conservative_summary":"조선일보는 이재명 대표의 2심 유죄 판결을 부각하며 민주당의 사법 리스크를 집중 보도했다. 당선무효형이 확정될 경우 정치적 파장이 클 것이라고 전망했다.","liberal_outlet":"한겨레","liberal_headline":"이재명 2심 유죄…야권 '정치탄압' 반발 확산","liberal_summary":"한겨레는 야권의 반발과 지지층 결집에 초점을 맞췄다. 검찰의 무리한 기소라는 비판 목소리를 함께 전달했다.","bias_score":75}]`
        }]
      })
    });

    if (!response.ok) throw new Error('Claude API 에러: ' + await response.text());
    const data = await response.json();
    const text = data.content.filter(b => b.type === 'text').map(b => b.text).join('');
    console.log('응답:', text.substring(0, 300));

    const match = text.match(/\[[\s\S]*?\]/);
    if (!match) throw new Error('JSON 없음: ' + text.substring(0, 300));
    const items = JSON.parse(match[0]);
    console.log('저장:', items.length);

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    await supabaseDelete('news_kr', todayStart.toISOString());
    await supabaseInsert('news_kr', items);

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, saved: items.length, topics: items.map(i => i.title) }) };
  } catch(e) {
    console.error('에러:', e.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
