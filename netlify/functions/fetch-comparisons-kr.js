// updated v2
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
          content: `오늘(${today}) 한국 뉴스를 검색해서 조선일보와 한겨레가 다르게 보도한 사건 5개를 찾아라.

응답은 반드시 JSON 배열만. 설명 금지. 마크다운 금지. 다른 텍스트 금지.

[{"title":"제목","category":"정치","conservative_outlet":"조선일보","conservative_headline":"헤드라인","conservative_summary":"요약","liberal_outlet":"한겨레","liberal_headline":"헤드라인","liberal_summary":"요약","bias_score":70}]

category는 정치/경제/사회/국제 중 하나. bias_score는 0~100 숫자.`
        }]
      })
    });

    if (!response.ok) throw new Error('Claude API 에러: ' + await response.text());
    const data = await response.json();
    const text = data.content.filter(b => b.type === 'text').map(b => b.text).join('');
    
    const match = text.match(/\[[\s\S]*?\]/);
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
