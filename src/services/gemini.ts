import { Message, ReflectionMode } from "../types";

export async function chatWithGemini(messages: Message[], mode: ReflectionMode = 'empathetic') {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, mode }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || "Failed to chat with AI");
  }
  const data = await response.json();
  return data.text;
}

export async function transformChatToBlog(messages: Message[], mode: ReflectionMode = 'empathetic') {
  const response = await fetch("/api/transform", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, mode }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || "Failed to transform chat");
  }
  const data = await response.json();
  return data.text;
}
