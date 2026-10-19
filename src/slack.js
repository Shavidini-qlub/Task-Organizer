// Minimal Slack Web API client. Calls go only to slack.com with the
// company bot token (SLACK_BOT_TOKEN), which never leaves the server.
// Bot scopes needed: chat:write, users:read, users:read.email,
// channels:read, groups:read.

export class SlackError extends Error {
  constructor(code) { super("slack: " + code); this.code = code; }
}

export function slackClient(token, fetchImpl = fetch) {
  // Form-encoded bodies work for every Web API method (JSON only works for
  // some), so all calls use them.
  async function call(method, params) {
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) body.set(k, typeof v === "string" ? v : JSON.stringify(v));
    }
    const res = await fetchImpl(`https://slack.com/api/${method}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    const data = await res.json().catch(() => ({ ok: false, error: "bad_response" }));
    if (!data.ok) throw new SlackError(data.error || "unknown_error");
    return data;
  }

  return {
    async lookupUserByEmail(email) {
      const data = await call("users.lookupByEmail", { email });
      return data.user.id;
    },
    // Channels the bot has been invited to.
    async botChannels() {
      const out = [];
      let cursor;
      for (let page = 0; page < 5; page++) {
        const data = await call("users.conversations", { types: "public_channel,private_channel", exclude_archived: "true", limit: "200", cursor });
        for (const c of data.channels || []) out.push({ id: c.id, name: c.name, isPrivate: !!c.is_private });
        cursor = data.response_metadata?.next_cursor;
        if (!cursor) break;
      }
      return out;
    },
    async isMember(channelId, slackUserId) {
      let cursor;
      for (let page = 0; page < 10; page++) {
        const data = await call("conversations.members", { channel: channelId, limit: "1000", cursor });
        if ((data.members || []).includes(slackUserId)) return true;
        cursor = data.response_metadata?.next_cursor;
        if (!cursor) break;
      }
      return false;
    },
    // Passing a user ID as the channel sends a DM from the bot.
    async post(channel, text, blocks) {
      await call("chat.postMessage", { channel, text, blocks, unfurl_links: "false", unfurl_media: "false" });
    },
  };
}

// Escapes user text for Slack so task text can't create mentions
// (<!channel>, <@U123>) or links.
export function slackEscape(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
