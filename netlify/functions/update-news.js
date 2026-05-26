// updated
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

exports.handler = async function () {
  try {
    // Claude API로 최신 뉴스 비교 가져오기
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

    const data = await response.json();

    // 텍스트 블록 추출
    const text = data.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('');

    // JSON 파싱
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) throw new Error('JSON을 찾을 수 없습니다');
    const items = JSON.parse(match[0]);

    // 오늘 데이터 삭제 후 새로 삽입
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    await supabase
      .from('news_kr')
      .delete()
      .gte('created_at', today.toISOString());

    const { error } = await supabase
      .from('news_kr')
      .insert(items);

    if (error) throw error;

    console.log(`뉴스 ${items.length}개 업데이트 완료`);

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, count: items.length })
    };

  } catch (e) {
    console.error('에러:', e.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: e.message })
    };
  }
};
