
const express = require("express");
const cors = require("cors");
require("dotenv").config();

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const MODELS = [
  {
    name: "gemini-3.5-flash-lite",
    timeout: 12000
  },
  {
    name: "gemini-3.8-flash",
    timeout: 15000
  }
];

const SYSTEM_INSTRUCTION = `
You are BYCO, a helpful personal AI assistant.

Created by Malik Uzair.

PERSONALITY:
- Be friendly, intelligent and natural.
- Talk like a helpful Indian AI assistant.
- Give direct and useful answers.
- Avoid unnecessary long introductions.
- Keep simple answers short.
- Explain difficult topics in simple steps.
- Give complete code when requested.
- Do not repeat information unnecessarily.

LANGUAGE:
- Roman Urdu input = Roman Urdu reply.
- Hindi input = simple Hindi reply.
- Hinglish input = natural Hinglish reply.
- English input = natural Indian English reply.
- Understand spelling mistakes and mixed languages.

CONVERSATION:
- Use the conversation history provided.
- Follow the user's instructions.
- If the user asks one step at a time, give one step.
- Never claim to remember unavailable information.

IMPORTANT:
- Be respectful and patient.
- Focus on the user's actual question.
- Do not make answers unnecessarily lengthy.
`;

app.post("/api/chat", async (req, res) => {
  try {
    const { message, language, history } = req.body;

    if (!message || typeof message !== "string") {
      return res.status(400).json({
        error: "Please enter a message."
      });
    }

    const apiKey = process.env.GEMINI_API_KEY?.trim();

    if (!apiKey) {
      return res.status(500).json({
        error: "Gemini API key missing in .env."
      });
    }

    const contents = [];

    if (Array.isArray(history)) {
      for (const item of history.slice(-10)) {
        if (
          (item.role === "user" || item.role === "model") &&
          typeof item.text === "string" &&
          item.text.trim()
        ) {
          contents.push({
            role: item.role,
            parts: [{ text: item.text }]
          });
        }
      }
    }

    contents.push({
      role: "user",
      parts: [{
        text: `Preferred language: ${language || "Automatically detect"}\n\n${message}`
      }]
    });

    let lastError = "All AI models are unavailable.";

    for (const model of MODELS) {
      console.log("Trying model:", model.name);

      const controller = new AbortController();

      const timeoutId = setTimeout(() => {
        controller.abort();
      }, model.timeout);

      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model.name}:generateContent`,
          {
            method: "POST",
            signal: controller.signal,
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": apiKey
            },
            body: JSON.stringify({
              systemInstruction: {
                parts: [{ text: SYSTEM_INSTRUCTION }]
              },
              contents,
              generationConfig: {
                temperature: 0.7,
                maxOutputTokens: 2048
              }
            })
          }
        );

        const data = await response.json();

        if (!response.ok) {
          lastError =
            data.error?.message || "AI request failed.";

          console.error(
            "Model error:",
            model.name,
            response.status,
            lastError
          );

          if (
            [404, 429, 500, 502, 503, 504].includes(response.status)
          ) {
            continue;
          }

          return res.status(response.status).json({
            error: lastError
          });
        }

        const reply = (data.candidates || [])
          .flatMap(candidate => candidate.content?.parts || [])
          .filter(part => typeof part.text === "string")
          .map(part => part.text)
          .join("\n")
          .trim();

        if (reply) {
          console.log("Success using:", model.name);
          return res.json({ reply });
        }

        lastError = "The AI returned an empty response.";

      } catch (error) {
        if (error.name === "AbortError") {
          lastError = model.name + " timed out.";
          console.error("Timeout:", model.name);
        } else {
          lastError = error.message;
          console.error("Connection error:", lastError);
        }

      } finally {
        clearTimeout(timeoutId);
      }
    }

    return res.status(503).json({
      error: "BYCO could not get a response. " + lastError
    });

  } catch (error) {
    console.error("BYCO Error:", error);

    return res.status(500).json({
      error: "BYCO could not connect to AI."
    });
  }
});

app.listen(3000, () => {
  console.log("BYCO server running at http://localhost:3000");
});
