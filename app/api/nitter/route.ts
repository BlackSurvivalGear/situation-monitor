import { NextResponse } from "next/server";
import type { Tweet, ApiResponse } from "@/lib/types/tweetTypes"; // adjust paths

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const fetchUserTweets = async (
  username: string,
  count = 15
): Promise<Tweet[]> => {
  try {
    const response = await fetch(
      "http://situation-monitor-api.vercel.app/nitter",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: [username] }),
        next: {
          revalidate: 60 * 60 * 3,
          tags: [`nitter:${username}`]
        }
      }
    );


    if (!response.ok) {
      console.warn(`Failed to fetch ${username}: HTTP ${response.status}`);
      return [];
    }

    const json: { success: boolean; count: number; tweets: Tweet[] } = await response.json();
    return json.tweets.slice(0, count); // respect max count
  } catch (err) {
    console.error(`Error fetching ${username}:`, err);
    return [];
  }
};

async function handleUsers(users: string[]): Promise<NextResponse> {
  const accumulator: Tweet[] = [];

  for (const usr of users) {
    const tweets = await fetchUserTweets(usr);
    accumulator.push(...tweets);
    await sleep(2000);
  }

  const toTime = (t: Tweet) =>
    new Date(t.created_at.replace(" · ", " ")).getTime();

  accumulator.sort((a, b) => toTime(b) - toTime(a));

  return NextResponse.json({
    code: 200,
    msg: "success",
    data: accumulator,
  } as ApiResponse<Tweet>);
}

// --- GET handler (supports ?users=user1,user2) ---
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const usersParam = url.searchParams.get("users");

    if (!usersParam) {
      return NextResponse.json(
        { error: "`users` query param required (comma-separated)" },
        { status: 400 }
      );
    }

    const users = usersParam.split(",").map((u) => u.trim()).filter(Boolean);
    if (users.length === 0) {
      return NextResponse.json(
        { error: "`users` must contain at least one username" },
        { status: 400 }
      );
    }

    return await handleUsers(users);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// --- POST handler ---
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { users }: { users: string[] } = body;

    if (!Array.isArray(users) || users.length === 0) {
      return NextResponse.json(
        { error: "`users` must be a non-empty array of usernames" },
        { status: 400 }
      );
    }

    return await handleUsers(users);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
