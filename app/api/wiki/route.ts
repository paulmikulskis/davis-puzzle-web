const UA = "DavisPuzzleWeb/1.0 (OT therapy worksheets)";
const IMAGE_RE = /^Invicon_[A-Za-z0-9_()]+\.png$/;
const ARTICLE_RE = /^[A-Za-z0-9_()]+$/;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind");
  const path = url.searchParams.get("path") ?? "";

  let upstream: string;
  if (kind === "image" && IMAGE_RE.test(path)) {
    upstream = `https://minecraft.wiki/images/${encodeURIComponent(path)}`;
  } else if (kind === "article" && ARTICLE_RE.test(path)) {
    upstream = `https://minecraft.wiki/w/${encodeURIComponent(path)}`;
  } else {
    return new Response("bad request", {
      status: 400,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const response = await fetch(upstream, {
    headers: { "User-Agent": UA },
    cache: "no-store",
  });

  if (!response.ok) {
    return new Response(null, {
      status: response.status,
      headers: { "Cache-Control": "no-store" },
    });
  }

  return new Response(response.body, {
    status: 200,
    headers: {
      "Content-Type": response.headers.get("content-type") ?? "application/octet-stream",
      "Cache-Control": "no-store",
    },
  });
}
