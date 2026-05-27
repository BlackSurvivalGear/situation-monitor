import { NextResponse } from "next/server";

const NITTER_INSTANCES = [
  "https://nitter.perennialte.ch",
  "https://nitter.net",
  "https://nitter.privacydev.net",
];

interface RssItem {
  title: string;
  link: string;
  pubDate: string;
  author: string;
  description: string;
  thumbnail?: string;
  enclosure?: { link: string };
}

interface RssResponse {
  status: string;
  feed: { title: string; image: string };
  items: RssItem[];
}

async function fetchRssForUser(username: string): Promise<RssResponse | null> {
  for (const instance of NITTER_INSTANCES) {
    try {
      const res = await fetch(`${instance}/${username}/rss`, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) continue;
      const xml = await res.text();
      if (!xml.includes("<item>")) continue;

      // Parse XML to JSON
      const items: RssItem[] = [];
      const itemRegex = /<item>([\s\S]*?)<\/item>/g;
      let match;
      while ((match = itemRegex.exec(xml)) !== null) {
        const itemXml = match[1];
        const getTag = (tag: string) => {
          const m = itemXml.match(
            new RegExp(`<${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>|<${tag}>([^<]*)</${tag}>`)
          );
          return m ? (m[1] || m[2] || "").trim() : "";
        };
        const encMatch = itemXml.match(
          /<enclosure[^>]+url="([^"]+)"/
        );
        items.push({
          title: getTag("title"),
          link: getTag("link"),
          pubDate: getTag("pubDate"),
          author: getTag("dc:creator"),
          description: getTag("description"),
          enclosure: encMatch ? { link: encMatch[1] } : undefined,
        });
      }

      if (items.length === 0) continue;

      // Extract feed info
      const feedTitle =
        xml.match(/<channel>[\s\S]*?<title>([^<]+)<\/title>/)?.[1] || username;
      const feedImage =
        xml.match(/<image>[\s\S]*?<url>([^<]+)<\/url>/)?.[1] || "";

      return {
        status: "ok",
        feed: { title: feedTitle, image: feedImage },
        items,
      };
    } catch {
      continue;
    }
  }
  return null;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const users = url.searchParams.get("users");

  if (!users) {
    return NextResponse.json(
      { error: "`users` query param required (comma-separated)" },
      { status: 400 }
    );
  }

  const userList = users
    .split(",")
    .map((u) => u.trim())
    .filter(Boolean);

  if (userList.length === 0) {
    return NextResponse.json(
      { error: "`users` must contain at least one username" },
      { status: 400 }
    );
  }

  // Fetch all users in parallel (server-side bypasses Cloudflare)
  const results = await Promise.all(
    userList.map(async (user) => {
      const data = await fetchRssForUser(user);
      return { user, data };
    })
  );

  const response: Record<string, RssResponse | null> = {};
  for (const { user, data } of results) {
    response[user] = data;
  }

  return NextResponse.json(response, {
    headers: {
      "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
    },
  });
}
