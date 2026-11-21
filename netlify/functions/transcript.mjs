// 유튜브 영상의 자막(대본)을 가져오는 서버 기능
// GET /api/transcript?v=<영상ID>&lang=<언어코드(선택)>

const CLIENTS = [
  {
    name: "ANDROID",
    id: "3",
    ua: "com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip",
    client: { clientName: "ANDROID", clientVersion: "20.10.38", androidSdkVersion: 34 },
  },
  {
    name: "ANDROID_VR",
    id: "28",
    ua: "com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip",
    client: { clientName: "ANDROID_VR", clientVersion: "1.60.19", androidSdkVersion: 32 },
  },
  {
    name: "IOS",
    id: "5",
    ua: "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)",
    client: { clientName: "IOS", clientVersion: "20.10.4", deviceModel: "iPhone16,2" },
  },
];

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

const clean = (s) => s.replace(/\s+/g, " ").trim();

async function getPlayer(videoId, c) {
  const res = await fetch("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": c.ua,
      "x-youtube-client-name": c.id,
      "x-youtube-client-version": c.client.clientVersion,
      "accept-language": "ko-KR,ko;q=0.9,en;q=0.8",
    },
    body: JSON.stringify({
      context: { client: { ...c.client, hl: "ko", gl: "KR" } },
      videoId,
      contentCheckOk: true,
      racyCheckOk: true,
    }),
  });
  if (!res.ok) throw new Error(`player ${c.name} HTTP ${res.status}`);
  return res.json();
}

function parseJson3(text) {
  const data = JSON.parse(text);
  const lines = [];
  for (const ev of data.events || []) {
    if (!ev.segs) continue;
    const t = clean(ev.segs.map((s) => s.utf8 || "").join(""));
    if (t) lines.push({ t: Math.floor((ev.tStartMs || 0) / 1000), text: t });
  }
  return lines;
}

function parseXml(text) {
  const lines = [];
  // 형식 1: <text start="1.2" dur="3">...</text>
  for (const m of text.matchAll(/<text[^>]*\bstart="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g)) {
    const t = clean(decodeEntities(decodeEntities(m[2].replace(/<[^>]+>/g, ""))));
    if (t) lines.push({ t: Math.floor(Number(m[1])), text: t });
  }
  if (lines.length) return lines;
  // 형식 2: <p t="1200" d="3000">...</p>
  for (const m of text.matchAll(/<p[^>]*\bt="(\d+)"[^>]*>([\s\S]*?)<\/p>/g)) {
    const t = clean(decodeEntities(decodeEntities(m[2].replace(/<[^>]+>/g, ""))));
    if (t) lines.push({ t: Math.floor(Number(m[1]) / 1000), text: t });
  }
  return lines;
}

async function getLines(baseUrl, ua) {
  const u = new URL(baseUrl);
  u.searchParams.set("fmt", "json3");
  const res = await fetch(u, { headers: { "user-agent": ua, "accept-language": "ko-KR,ko;q=0.9" } });
  if (!res.ok) throw new Error(`timedtext HTTP ${res.status}`);
  const text = await res.text();
  if (!text.trim()) return [];
  try {
    return parseJson3(text);
  } catch {
    return parseXml(text);
  }
}

function pickTrack(tracks, lang) {
  const isAuto = (t) => t.kind === "asr";
  if (lang) {
    const [code, kind] = lang.split("|");
    const exact = tracks.find((t) => t.languageCode === code && (kind === "asr") === isAuto(t));
    if (exact) return exact;
    const any = tracks.find((t) => t.languageCode === code);
    if (any) return any;
  }
  return (
    tracks.find((t) => t.languageCode === "ko" && !isAuto(t)) ||
    tracks.find((t) => t.languageCode === "ko") ||
    tracks.find((t) => !isAuto(t)) ||
    tracks[0]
  );
}

const trackName = (t) => t.name?.simpleText || t.name?.runs?.map((r) => r.text).join("") || t.languageCode;

export default async (req) => {
  const url = new URL(req.url);
  const videoId = url.searchParams.get("v") || "";
  const lang = url.searchParams.get("lang") || "";

  if (!/^[\w-]{11}$/.test(videoId)) {
    return json({ error: "bad_id", message: "유튜브 링크를 다시 확인해 주세요." }, 400);
  }

  let lastReason = "";
  let sawPlayable = false;
  let details = null;

  for (const c of CLIENTS) {
    try {
      const player = await getPlayer(videoId, c);
      const status = player.playabilityStatus?.status;
      if (player.videoDetails?.title) details = player.videoDetails;
      if (status && status !== "OK") {
        lastReason = `${c.name}: ${status} ${player.playabilityStatus?.reason || ""}`.trim();
        continue;
      }
      sawPlayable = true;
      const tracks = player.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
      if (!tracks.length) {
        lastReason = `${c.name}: no captions`;
        continue;
      }
      const track = pickTrack(tracks, lang);
      const lines = await getLines(track.baseUrl, c.ua);
      if (!lines.length) {
        lastReason = `${c.name}: empty transcript`;
        continue;
      }
      return json({
        videoId,
        title: details?.title || "",
        author: details?.author || "",
        lang: `${track.languageCode}|${track.kind === "asr" ? "asr" : "manual"}`,
        tracks: tracks.map((t) => ({
          code: `${t.languageCode}|${t.kind === "asr" ? "asr" : "manual"}`,
          name: trackName(t),
          auto: t.kind === "asr",
        })),
        lines,
      });
    } catch (e) {
      lastReason = `${c.name}: ${e.message}`;
    }
  }

  if (sawPlayable && /no captions/.test(lastReason)) {
    return json(
      { error: "no_captions", message: "이 영상에는 자막이 없어서 대본을 가져올 수 없어요.", title: details?.title || "" },
      404,
    );
  }
  return json(
    {
      error: "blocked",
      message: "유튜브가 지금 이 영상의 대본을 내주지 않아요. 잠시 뒤에 다시 시도하거나 다른 영상으로 해 보세요.",
      detail: lastReason,
    },
    502,
  );
};

export const config = { path: "/api/transcript" };
