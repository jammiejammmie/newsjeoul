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

  if (event.httpMethod) {
    const adminKey = event.headers?.['x-admin-key'] || event.queryStringParameters?.key;
    if (adminKey !== process.env.ADMIN_KEY) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
    }
  }

  console.log('fetch-election-kr 시작:', new Date().toISOString());

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
          content: `2026년 6월 3일 한국 지방선거 최신 여론조사 결과를 검색해줘.
서울시장, 부산시장, 대구시장, 경기도지사, 부산 북구갑 국회의원 보궐선거 결과를 찾아줘.

반드시 아래 JSON 배열 형식으로만 답해. 다른 말 하지마.

[
  {
    "region": "서울특별시",
    "election_type": "광역",
    "candidate_a": "정원오",
    "candidate_a_party": "더불어민주당",
    "candidate_a_pct": 46,
    "candidate_b": "오세훈",
    "candidate_b_party": "국민의힘",
    "candidate_b_pct": 38,
    "candidate_c": null,
    "candidate_c_party": null,
    "candidate_c_pct": null,
    "candidate_d": null,
    "candidate_d_party": null,
    "candidate_d_pct": null,
    "poll_company": "한국갤럽",
    "media_outlet": "뉴스1",
    "survey_date": "2026-05-26",
    "sample_size": 1000
  }
]`
        }]
      })
    });

    if (!response.ok) throw new Error('Claude API 에러: ' + await response.text());

    const data = await response.json();
    const text = data.content.filter(b => b.type === 'text').map(b => b.text).join('');
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) throw new Error('JSON 없음: ' + text.substring(0, 200));
    const polls = JSON.parse(match[0]);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    await supabaseDelete('polls_kr', today.toISOString());
    await supabaseInsert('polls_kr', polls);

    console.log(`저장 완료: ${polls.length}`);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true, saved: polls.length })
    };

  } catch(e) {
    console.error('에러:', e.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
