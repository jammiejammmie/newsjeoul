const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

async function supabaseDelete(table, gte_date) {
  await fetch(`${SUPABASE_URL}/rest/v1/${table}?created_at=gte.${gte_date}`, {
    method: 'DELETE',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY,
      'Content-Type': 'application/json'
    }
  });
}

async function supabaseInsert(table, data) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify(data)
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error('Supabase insert error: ' + err);
  }
}

exports.handler = async function(event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  // 어드민 키 체크 (스케줄 실행 시에는 httpMethod가 없으므로 통과)
  if (event.httpMethod) {
    const adminKey = event.headers?.['x-admin-key'] || event.queryStringParameters?.key;
    if (adminKey !== process.env.ADMIN_KEY) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
    }
  }

  console.log('fetch-comparisons-kr 시작:', new Date().toISOString());

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4000,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: [{
          role: 'user',
          content: `오늘 한국 뉴스에서 보수 언론(조선일보, 동아일보)과 진보 언론(한겨레, 경향신문)이 같은 사건을 다르게 보도한 것 5개를 찾아줘.

반드시 아래 JSON 배열 형식으로만 답해. 다른 말은 하지마. JSON 외 아무것도 쓰지마.

[
  {
    "title": "사건 제목",
    "category": "정치",
    "conservative_outlet": "조선일보",
    "conservative_headline": "보수 언론 헤드라인",
    "conservative_summary": "보수 관점 요약 2~3문장",
    "liberal_outlet": "한겨레",
    "liberal_headline": "진보 언론 헤드라인",
    "liberal_summary": "진보 관점 요약 2~3문장",
    "bias_score": 70
  }
]

bias_score는 0(완전 진보) ~ 100(완전 보수) 숫자.
category는 정치/경제/사회/국제 중 하나.`
        }]
      })
    });

    if (!response.ok) throw new Error('Claude API 에러: ' + await response.text());

    const data = await response.json();
    const text = data.content.filter(b => b.type === 'text').map(b => b.text).join('');
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) throw new Error('JSON 없음: ' + text.substring(0, 200));
    const items = JSON.parse(match[0]);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    await supabaseDelete('news_kr', today.toISOString());
    await supabaseInsert('news_kr', items);

    console.log(`저장 완료: ${items.length}`);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true, saved: items.length, topics: items.map(i => i.title) })
    };

  } catch(e) {
    console.error('에러:', e.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
