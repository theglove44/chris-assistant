import { z } from "zod";
import { TwitterApi } from "twitter-api-v2";
import { registerTool } from "./registry.js";

const KEY = process.env.X_CONSUMER_KEY;
const SECRET = process.env.X_CONSUMER_SECRET;
const TOKEN = process.env.X_ACCESS_TOKEN;
const TOKEN_SECRET = process.env.X_ACCESS_TOKEN_SECRET;

function makeClient(): TwitterApi {
  return new TwitterApi({
    appKey: KEY!,
    appSecret: SECRET!,
    accessToken: TOKEN!,
    accessSecret: TOKEN_SECRET!,
  });
}

if (KEY && SECRET && TOKEN && TOKEN_SECRET) {
  registerTool({
    name: "x_me",
    category: "always",
    description: "Get your own X profile (@cupcle_trader) — follower count, bio, tweet count.",
    zodSchema: {},
    jsonSchemaParameters: { type: "object", required: [], properties: {} },
    execute: async (): Promise<string> => {
      const { data } = await makeClient().v2.me({ "user.fields": ["public_metrics", "description"] });
      const m = data.public_metrics!;
      return [
        `@${data.username} — ${data.name}`,
        `Bio: ${data.description ?? "(none)"}`,
        `Followers: ${m.followers_count} | Following: ${m.following_count} | Tweets: ${m.tweet_count}`,
      ].join("\n");
    },
  });

  registerTool({
    name: "x_timeline",
    category: "always",
    description: "Get recent tweets from your @cupcle_trader timeline.",
    zodSchema: {
      count: z.number().int().min(1).max(20).optional().describe("Number of tweets to fetch (default 5, max 20)"),
    },
    jsonSchemaParameters: {
      type: "object",
      required: [],
      properties: {
        count: { type: "number", description: "Number of tweets to fetch (default 5, max 20)" },
      },
    },
    execute: async (args: { count?: number }): Promise<string> => {
      const client = makeClient();
      const me = await client.v2.me();
      const timeline = await client.v2.userTimeline(me.data.id, {
        max_results: args.count ?? 5,
        "tweet.fields": ["created_at", "public_metrics"],
      });
      const tweets = timeline.data.data ?? [];
      if (tweets.length === 0) return "No tweets found.";
      return tweets
        .map((t) => {
          const m = t.public_metrics!;
          return `[${t.created_at}] (${t.id})\n  ${t.text}\n  ❤ ${m.like_count}  🔁 ${m.retweet_count}  💬 ${m.reply_count}`;
        })
        .join("\n\n");
    },
  });

  registerTool({
    name: "x_search",
    category: "always",
    description: "Search recent tweets on X.",
    zodSchema: {
      query: z.string().describe("Search query"),
      count: z.number().int().min(1).max(20).optional().describe("Number of results (default 10, max 20)"),
    },
    jsonSchemaParameters: {
      type: "object",
      required: ["query"],
      properties: {
        query: { type: "string", description: "Search query" },
        count: { type: "number", description: "Number of results (default 10, max 20)" },
      },
    },
    execute: async (args: { query: string; count?: number }): Promise<string> => {
      const results = await makeClient().v2.search(args.query, {
        max_results: args.count ?? 10,
        "tweet.fields": ["created_at", "public_metrics", "author_id"],
      });
      const tweets = results.data.data ?? [];
      if (tweets.length === 0) return `No results for "${args.query}".`;
      return tweets
        .map((t) => `[${t.created_at}] by ${t.author_id} (${t.id})\n  ${t.text}`)
        .join("\n\n");
    },
  });

  registerTool({
    name: "x_tweet",
    category: "always",
    description: "Post a tweet to @cupcle_trader. Requires write access (X Basic tier).",
    zodSchema: {
      text: z.string().max(280).describe("Tweet text (max 280 characters)"),
    },
    jsonSchemaParameters: {
      type: "object",
      required: ["text"],
      properties: {
        text: { type: "string", description: "Tweet text (max 280 characters)" },
      },
    },
    execute: async (args: { text: string }): Promise<string> => {
      const { data } = await makeClient().v2.tweet(args.text);
      return `Tweet posted! ID: ${data.id}\nhttps://x.com/i/status/${data.id}`;
    },
  });

  registerTool({
    name: "x_reply",
    category: "always",
    description: "Reply to a tweet on X. Requires write access (X Basic tier).",
    zodSchema: {
      tweet_id: z.string().describe("ID of the tweet to reply to"),
      text: z.string().max(280).describe("Reply text (max 280 characters)"),
    },
    jsonSchemaParameters: {
      type: "object",
      required: ["tweet_id", "text"],
      properties: {
        tweet_id: { type: "string", description: "ID of the tweet to reply to" },
        text: { type: "string", description: "Reply text (max 280 characters)" },
      },
    },
    execute: async (args: { tweet_id: string; text: string }): Promise<string> => {
      const { data } = await makeClient().v2.reply(args.text, args.tweet_id);
      return `Reply posted! ID: ${data.id}\nhttps://x.com/i/status/${data.id}`;
    },
  });

  registerTool({
    name: "x_like",
    category: "always",
    description: "Like a tweet on X. Requires write access (X Basic tier).",
    zodSchema: {
      tweet_id: z.string().describe("ID of the tweet to like"),
    },
    jsonSchemaParameters: {
      type: "object",
      required: ["tweet_id"],
      properties: {
        tweet_id: { type: "string", description: "ID of the tweet to like" },
      },
    },
    execute: async (args: { tweet_id: string }): Promise<string> => {
      const client = makeClient();
      const me = await client.v2.me();
      await client.v2.like(me.data.id, args.tweet_id);
      return `Liked tweet ${args.tweet_id}.`;
    },
  });

  registerTool({
    name: "x_delete",
    category: "always",
    description: "Delete one of your tweets on X. Requires write access (X Basic tier).",
    zodSchema: {
      tweet_id: z.string().describe("ID of the tweet to delete"),
    },
    jsonSchemaParameters: {
      type: "object",
      required: ["tweet_id"],
      properties: {
        tweet_id: { type: "string", description: "ID of the tweet to delete" },
      },
    },
    execute: async (args: { tweet_id: string }): Promise<string> => {
      await makeClient().v2.deleteTweet(args.tweet_id);
      return `Tweet ${args.tweet_id} deleted.`;
    },
  });

  console.log("[tools] x_me, x_timeline, x_search, x_tweet, x_reply, x_like, x_delete registered");
} else {
  console.log("[tools] x_* tools not registered (X credentials missing — set X_CONSUMER_KEY, X_CONSUMER_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET)");
}
