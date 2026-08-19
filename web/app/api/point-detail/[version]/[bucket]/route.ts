import { readFile } from "node:fs/promises";
import path from "node:path";

// 지점 상세(버전당 12MB, 조각 100개)는 저장소에 두지 않고 BEV 이미지와 같은 Drive 폴더에
// 올린다. 저장소에는 조각 번호 -> fileId 인 detail_map_<version>.json(약 4KB)만 남는다.
//
// 브라우저가 Drive 를 직접 부르지 않고 이 경로를 거치는 이유 두 가지:
//   1. API 키가 브라우저로 나가지 않는다 (Vercel 환경변수에만 둔다).
//   2. Drive 응답은 `Cache-Control: private, max-age=0` 이라 캐시되지 않는다. 여기서 다시
//      헤더를 달아 CDN 이 붙잡게 한다 — 조각은 한번 올리면 바뀌지 않으므로 immutable 이다.

const DRIVE_FILE_URL = "https://www.googleapis.com/drive/v3/files";

function json(body: unknown, status: number) {
  return Response.json(body, { status });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ version: string; bucket: string }> }
) {
  const { version, bucket } = await params;

  // 경로 파라미터가 그대로 파일 경로에 들어가므로 형식을 좁혀 경로 이탈을 막는다.
  if (!/^[A-Za-z0-9_]+$/.test(version) || !/^\d+$/.test(bucket)) {
    return json({ error: "bad request" }, 400);
  }

  const apiKey = process.env.GOOGLE_DRIVE_API_KEY;
  if (!apiKey) {
    return json({ error: "GOOGLE_DRIVE_API_KEY not configured" }, 500);
  }

  let fileId: string | undefined;
  try {
    const mapPath = path.join(process.cwd(), "public", "data", `detail_map_${version}.json`);
    const map = JSON.parse(await readFile(mapPath, "utf-8")) as Record<string, string>;
    fileId = map[bucket];
  } catch {
    // 상세를 올리지 않은 버전 — 패널은 404 를 "상세 없음"으로 처리한다.
    return json({ error: "no detail for this version" }, 404);
  }
  if (!fileId) return json({ error: "no such bucket" }, 404);

  const upstream = await fetch(`${DRIVE_FILE_URL}/${fileId}?alt=media&key=${apiKey}`);
  if (!upstream.ok) {
    return json({ error: `drive ${upstream.status}` }, 502);
  }

  return new Response(upstream.body, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      // 조각은 내용이 바뀌면 새 버전으로 올라오므로 영구 캐시해도 안전하다.
      "cache-control": "public, max-age=3600, s-maxage=31536000, immutable",
    },
  });
}
