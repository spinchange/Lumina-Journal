import { Message } from "../types";

export async function chatWithGemini(messages: Message[]) {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
  });

  if (!response.ok) throw new Error("Failed to chat with AI");
  const data = await response.json();
  return data.text;
}

export async function transformChatToBlog(messages: Message[]) {
  const response = await fetch("/api/transform", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
  });

  if (!response.ok) throw new Error("Failed to transform chat");
  const data = await response.json();
  return data.text;
}
