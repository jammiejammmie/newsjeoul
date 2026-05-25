const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

exports.handler = async function () {
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
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

반드시 아래 JSON 배열 형식으로만 답해. 다른 말은 하지마.

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
    "survey_date": "2026-05-20",
    "sample_size": 1000
  }
]`
        }]
      })
    });

    const data = await response.json();

    const text = data.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('');

    const match = text.match(/\[[\s\S]*\]/);
    if (!match) throw new Error('JSON을 찾을 수 없습니다');
    const polls = JSON.parse(match[0]);

    // 오늘 데이터 삭제 후 재삽입
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    await supabase
      .from('polls_kr')
      .delete()
      .gte('created_at', today.toISOString());

    const { error } = await supabase
      .from('polls_kr')
      .insert(polls);

    if (error) throw error;

    console.log(`여론조사 ${polls.length}개 업데이트 완료`);

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, count: polls.length })
    };

  } catch (e) {
    console.error('에러:', e.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: e.message })
    };
  }
};
