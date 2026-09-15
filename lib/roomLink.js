'use strict';

const validCode = /^[A-Za-z0-9_-]{4,100}$/;
const error = (message, status = 400) => Object.assign(new Error(message), { status });

// Invitation codes are not channel codes. Resolve ONLY official room invitations,
// without sending account headers, cookies, or following off-site redirects.
async function resolveRoomLink(input, fetchImpl = fetch) {
  const text = typeof input === 'string' ? input.trim() : '';
  if (validCode.test(text)) return text;
  let url;
  try { url = new URL(text); } catch { throw error('اكتب كود الغرفة أو رابط Clubhouse صالح'); }
  if (url.protocol !== 'https:' || !['clubhouse.com', 'www.clubhouse.com', 'joinclubhouse.com', 'www.joinclubhouse.com'].includes(url.hostname) || url.port || url.username || url.password) throw error('الرابط لازم يكون رابط Clubhouse رسمي وآمن');
  const direct = url.pathname.match(/^\/room\/([A-Za-z0-9_-]{4,100})\/?$/);
  if (direct) return direct[1];
  if (!/^\/i\/[^/]+\/[A-Za-z0-9_-]+\/?$/.test(url.pathname) || !['clubhouse.com', 'www.clubhouse.com'].includes(url.hostname)) throw error('صيغة رابط الغرفة غير مدعومة');
  const response = await fetchImpl(`https://www.clubhouse.com${url.pathname}`, { redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw error('تعذر فتح رابط الدعوة؛ تأكد إنه لسه متاح', 502);
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > 2 * 1024 * 1024) throw error('صفحة الدعوة أكبر من الحجم المتوقع', 502);
    chunks.push(Buffer.from(chunk));
  }
  const html = Buffer.concat(chunks).toString('utf8');
  const data = html.match(/<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!data) throw error('تعذر استخراج الغرفة من الدعوة؛ استخدم رابط /room/ أو كود الغرفة', 502);
  let route;
  try { route = JSON.parse(data[1]).props?.pageProps?.routeProps; } catch { throw error('بيانات صفحة الدعوة غير صالحة', 502); }
  const channel = route?.channel?.channel;
  if (!validCode.test(channel || '')) throw error('رابط الدعوة لم يرجع كود غرفة صالح', 502);
  if (route.is_live === false || route.channel.is_live === false) throw error('الغرفة الموجودة في الدعوة انتهت', 410);
  return channel;
}

module.exports = { resolveRoomLink };
