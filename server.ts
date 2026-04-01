import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Initialize Gemini AI on the server
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

  // API Routes
  app.post("/api/chat", async (req, res) => {
    try {
      const { messages } = req.body;
      const model = ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: messages.map((m: any) => ({
          role: m.role,
          parts: [{ text: m.content }]
        })),
        config: {
          systemInstruction: "You are a friendly, empathetic journaling assistant. Your goal is to help the user reflect on their day by asking insightful questions. Keep your responses concise and encouraging. Don't be overly formal.",
        }
      });

      const result = await model;
      res.json({ text: result.text || "I'm sorry, I couldn't process that." });
    } catch (error) {
      console.error("Server Chat Error:", error);
      res.status(500).json({ error: "Failed to chat with AI" });
    }
  });

  app.post("/api/transform", async (req, res) => {
    try {
      const { messages } = req.body;
      const chatContext = messages.map((m: any) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n');
      
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          {
            parts: [{
              text: `Based on the following conversation, write a polished, reflective journal entry or blog post. 
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
    } catch (error) {
      console.error("Server Transform Error:", error);
      res.status(500).json({ error: "Failed to transform chat" });
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
