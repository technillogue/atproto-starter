import {
  BskyAgent,
  AppBskyFeedPost,
  AppBskyEmbedImages,
  BlobRef,
  RichText,
} from "@atproto/api";
import { ChatCompletionRequestMessage, Configuration, OpenAIApi } from "openai";

const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

async function uploadImage(agent: BskyAgent, url: string): Promise<BlobRef> {
  const response = await fetch(url);
  const image_bytes: Uint8Array = await response
    .arrayBuffer()
    .then((buf) => new Uint8Array(buf));
  const mimeType = response.headers.get("content-type") ?? "image/png";
  console.log(image_bytes.byteLength, mimeType);
  const { success, data: outputData } = await agent.uploadBlob(image_bytes, {
    encoding: mimeType,
  });
  if (success) return outputData.blob;
  else throw new Error("Image upload failed");
}


function truncate(text: string): string {
  const rt = new RichText({text: text});
  if (rt.graphemeLength > 300) {
    const truncatedText = rt.unicodeText.slice(0, 297);
    return truncatedText + "...";
  }
  return rt.text
}

type MaybeRecord = Omit<AppBskyFeedPost.Record, "CreatedAt"> | undefined;

async function get_nonempty_parent(agent: BskyAgent, uri: string): Promise<string | undefined> {
  console.log("getting parent of ", uri)
  let thread_view: ThreadViewPost | unknown = await agent.getPostThread({uri: uri, depth: 3}).then((r) => r.data.thread)
  while (isThreadViewPost(thread_view)) {
    if (AppBskyFeedPost.isRecord(thread_view.post.record) && thread_view.post.record.text) {
      return thread_view.post.record.text
    }
    thread_view = thread_view.parent
  }
  return undefined
}

async function handle_notification(agent: BskyAgent, notif: Notification): Promise<MaybeRecord> {
  const post_record: AppBskyFeedPost.Record =
    notif.record as AppBskyFeedPost.Record;

  // have you tried addressing the problem by eating your very tasty snake tail made of cherries?
  const url = "https://cdn.bsky.social/imgproxy/L46R5oiytIOQHqh_0Wk-g5U-BTrzk1hMuEnQZ2c0z0M/rs:fit:2000:2000:1:0/plain/bafkreifakpfzur5vv55znxwjwrxatvlt234ja4idvvlr46iocyja4aeuna@jpeg"
  const blob = await uploadImage(agent, url);
  console.log(blob);
  const embed: AppBskyEmbedImages.Main = {
    images: [{ image: blob, alt: prompt }],
    // $type is required for it to show up and is different from the ts type
    $type: "app.bsky.embed.images",
  };
  const post_text = post_record.text ?? await get_nonempty_parent(agent, notif.uri)
  const reply_ref = { uri: notif.uri, cid: notif.cid };
  return {
    text: truncate(`echoing $post_text`),
    reply: {
      root: post_record.reply?.root ?? reply_ref,
      parent: reply_ref,
    },
    embed: embed,
  };
}

async function process_notifs(agent: BskyAgent): Promise<void> {
  const notifs = await agent.listNotifications();
  for (const n of notifs.data.notifications) {
    if (n.isRead) continue;
    console.log(n);
    if (n.reason == "mention" || n.reason == "reply") {
      await agent.like(n.uri, n.cid)

      const reply_record = await handle_notification(agent, n)
      if (typeof reply_record !== "undefined") {
        console.log("reply record is undefined, skipping")
        const post_result = await agent.post(reply_record);
        // await agent.repost(post_result.uri, post_result.cid)
      }
      await agent.updateSeenNotifications(n.indexedAt);
    } else if (n.reason == "follow") {
      await agent.follow(n.author.did);
    }
  }
  await agent.updateSeenNotifications(notifs.data.notifications[0].indexedAt);
}

async function main(): Promise<void> {
  const agent = new BskyAgent({ service: "https://bsky.social" });
  const password = process.env.PASSWORD;
  if (!password) throw new Error("PASSWORD env var not set");
  await agent.login({ identifier: process.env.USERNAME;, password });
  console.log("logged in");
  while (true) {
    await process_notifs(agent);
    await new Promise((r) => setTimeout(r, 1000));
  }
}

main();
