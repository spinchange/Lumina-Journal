import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Helper to get Gemini instance
  const getAI = () => {
    const rawKey = process.env.CUSTOM_GEMINI_KEY || process.env.GEMINI_API_KEY || process.env.API_KEY;
    const apiKey = rawKey?.trim();
    
    if (!apiKey) {
      throw new Error("No API key found. Please ensure CUSTOM_GEMINI_KEY is set in the Secrets panel.");
    }
    return new GoogleGenAI({ apiKey });
  };

  const PERSONAS: Record<string, string> = {
    empathetic: "You are a friendly, empathetic journaling assistant. Your goal is to help the user reflect on their day by asking insightful questions. Keep your responses concise and encouraging. Don't be overly formal.",
    stoic: "You are a Stoic philosopher. Help the user reflect on their day through the lens of Stoicism. Focus on what is within their control, the nature of their reactions, and how they can cultivate virtue (wisdom, justice, courage, temperance). Be calm, direct, and thought-provoking.",
    creative: "You are a Creative Muse. Help the user explore the imaginative and artistic aspects of their day. Ask about inspirations, metaphors, and the 'what ifs'. Encourage them to see their life as a creative project.",
    coach: "You are a Growth Coach. Help the user reflect on their progress, habits, and goals. Ask about wins, challenges, and actionable takeaways. Be motivating, structured, and focused on self-improvement.",
    gratitude: "You are a Gratitude Guide. Your sole focus is to help the user identify and appreciate the positive aspects of their day, no matter how small. Ask about moments of joy, kindness received, and things they are thankful for. Be warm and uplifting."
  };

  // API Routes
  app.post("/api/chat", async (req, res) => {
    try {
      const { messages, mode = 'empathetic' } = req.body;
      const ai = getAI();
      
      // Gemini API requirement: History must start with a 'user' message.
      const filteredMessages = messages[0]?.role === 'model' ? messages.slice(1) : messages;

      if (filteredMessages.length === 0) {
        return res.json({ text: "How can I help you today?" });
      }

      const result = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: filteredMessages.map((m: any) => ({
          role: m.role,
          parts: [{ text: m.content }]
        })),
        config: {
          systemInstruction: PERSONAS[mode as keyof typeof PERSONAS] || PERSONAS.empathetic,
        }
      });

      res.json({ text: result.text || "I'm sorry, I couldn't process that." });
    } catch (error: any) {
      console.error("Server Chat Error:", error);
      res.status(500).json({ error: error.message || "Failed to chat with AI" });
    }
  });

  app.post("/api/transform", async (req, res) => {
    try {
      const { messages, mode = 'empathetic' } = req.body;
      const ai = getAI();
      const filteredMessages = messages[0]?.role === 'model' ? messages.slice(1) : messages;
      const chatContext = filteredMessages.map((m: any) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n');
      
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          {
            parts: [{
              text: `Based on the following conversation (which was conducted in the style of a ${mode} reflection), write a polished, reflective journal entry or blog post. 
              Use a first-person perspective as if the user wrote it. 
              Give it a meaningful title. 
              Format the output as Markdown with the title as an H1.
              
              Conversation:
              ${chatContext}`
            }]
          }
        ]
      });

      res.json({ text: response.text || "# Untitled Entry\n\nCould not generate content." });
    } catch (error: any) {
      console.error("Server Transform Error:", error);
      res.status(500).json({ error: error.message || "Failed to transform chat" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
