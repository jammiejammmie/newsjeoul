// YouTube 채널 업데이트 (매일 1회)
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

const CHANNELS = [
  // 보수
  { channel_id: 'UC0M-_02RJqMlGTKUjF1WhJg', channel_name: '가로세로연구소', lean: 'conservative' },
  { channel_id: 'UCgOLQwRv1r2m9mhE1tfsn3Q', channel_name: '신의한수', lean: 'conservative' },
  { channel_id: 'UCdp4_yTBhQmB8E339Lafzow', channel_name: '조선일보TV', lean: 'conservative' },
  { channel_id: 'UCWlV3Lz_55UaX4JsMj-z__Q', channel_name: 'TV조선뉴스', lean: 'conservative' },
  // 진보
  { channel_id: 'UCRr5JaYMJPsEMFGrFkEFAZg', channel_name: '김어준의겸손은힘들다', lean: 'liberal' },
  { channel_id: 'UCzCi8OHJdioqTsLXkL0frog', channel_name: '열린공감TV', lean: 'liberal' },
  { channel_id: 'UC8wAMPFoJVXRH_PBhMcXMlQ', channel_name: '한겨레TV', lean: 'liberal' },
  { channel_id: 'UCBCnVEzBCZrMgHnZLRPpOFg', channel_name: '매불쇼', lean: 'liberal' },
  { channel_id: 'UCcQTRi69dsVYHN3exePtZ1A', channel_name: 'KBS뉴스', lean: 'liberal' },
];

async function getChannelInfo(channelId) {
  const url = `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&id=${channelId}&key=${YOUTUBE_API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('YouTube API 오류');
  const data = await res.json();
  return data.items?.[0];
}

async function getLatestVideo(channelId) {
  const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${channelId}&order=date&maxResults=1&type=video&key=${YOUTUBE_API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  return data.items?.[0];
}

async function supabaseUpsert(data) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/youtube_channels`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates'
    },
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
    const results = [];
    for (const ch of CHANNELS) {
      try {
        const [channelInfo, latestVideo] = await Promise.all([
          getChannelInfo(ch.channel_id),
          getLatestVideo(ch.channel_id)
        ]);
        if (!channelInfo) continue;

        const record = {
          channel_id: ch.channel_id,
          channel_name: ch.channel_name,
          lean: ch.lean,
          thumbnail_url: channelInfo.snippet?.thumbnails?.medium?.url,
          subscriber_count: parseInt(channelInfo.statistics?.subscriberCount || 0),
          latest_video_title: latestVideo?.snippet?.title,
          latest_video_id: latestVideo?.id?.videoId,
          latest_video_date: latestVideo?.snippet?.publishedAt?.split('T')[0],
          latest_video_thumbnail: latestVideo?.snippet?.thumbnails?.medium?.url,
          updated_at: new Date().toISOString()
        };
        await supabaseUpsert(record);
        results.push(ch.channel_name);
      } catch(e) {
        console.error(`${ch.channel_name} 오류:`, e.message);
      }
    }
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, updated: results }) };
  } catch(e) {
    console.error(e.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
