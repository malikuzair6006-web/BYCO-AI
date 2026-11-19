
const express = require("express");
const cors = require("cors");
require("dotenv").config();

const app = express();

app.use(cors());
app.use(express.json({ limit: "12mb" }));
app.use(express.static(__dirname));

/* GEMINI MODEL */

const MODEL = "gemini-3.5-flash-lite";

/* SYSTEM INSTRUCTION */

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

IMAGE ANALYSIS:
- Analyze uploaded images.
- Describe visible objects, diagrams, text and details.
- Help explain educational diagrams and screenshots.
- Read visible text when possible.
- Solve educational questions shown in images.
- If an image is unclear, say so honestly.
- Never pretend to see details that are not visible.

CONVERSATION:
- Use the conversation history provided in the prompt.
- Follow the user's instructions.
- If the user asks one step at a time, give one step.
- Never claim to remember unavailable information.

IMPORTANT:
- Be respectful and patient.
- Focus on the user's actual question.
- Do not make answers unnecessarily lengthy.
`;

/* CHAT API */

app.post("/api/chat", async (req, res) => {
  let timeoutId;

  try {
    const { message, language, history, image } = req.body;

    const hasMessage =
      typeof message === "string" && message.trim().length > 0;

    const hasImage =
      typeof image === "string" && image.length > 0;

    if (!hasMessage && !hasImage) {
      return res.status(400).json({
        error: "Please enter a message or upload an image."
      });
    }

    /* API KEY */

    const apiKey = process.env.GEMINI_API_KEY?.trim();

    if (!apiKey) {
      return res.status(500).json({
        error: "Gemini API key missing in .env."
      });
    }

    /* PREPARE CHAT HISTORY */

    let historyText = "";

    if (Array.isArray(history)) {
      historyText = history
        .slice(-10)
        .filter(item =>
          (item.role === "user" || item.role === "model") &&
          typeof item.text === "string" &&
          item.text.trim()
        )
        .map(item => {
          const role =
            item.role === "user" ? "User" : "BYCO";

          return `${role}: ${item.text.slice(0, 4000)}`;
        })
        .join("\n\n");
    }

    /* PREPARE INPUT */

    const input = [];

    const prompt = `
Preferred language: ${language || "Automatically detect"}

Previous conversation:
${historyText || "No previous conversation."}

Current user message:
${hasMessage
  ? message.trim()
  : "Please analyze this uploaded image and explain what you can see."}
`;

    /* IMAGE VALIDATION */

    if (hasImage) {
      const match = image.match(
        /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/
      );

      if (!match) {
        return res.status(400).json({
          error: "Invalid image format. Please upload JPG, PNG or WEBP."
        });
      }

      const mimeType = match[1];
      const base64Data = match[2];

      const imageSize = Buffer.from(base64Data, "base64").length;

      if (imageSize === 0 || imageSize > 5 * 1024 * 1024) {
        return res.status(400).json({
          error: "Image must be smaller than 5 MB."
        });
      }

      input.push({
        type: "image",
        mime_type: mimeType,
        data: base64Data
      });
    }

    /* ADD TEXT */

    input.push({
      type: "text",
      text: prompt
    });

    /* CALL GEMINI INTERACTIONS API */

    console.log("Trying model:", MODEL);

    const controller = new AbortController();

    timeoutId = setTimeout(() => {
      controller.abort();
    }, 60000);

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/interactions",
      {
        method: "POST",

        signal: controller.signal,

        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey
        },

        body: JSON.stringify({
          model: MODEL,
          store: false,

          system_instruction: SYSTEM_INSTRUCTION,

          input: input,

          generation_config: {
            thinking_level: "minimal",
            max_output_tokens: 2048
          }
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("Gemini API Error:", data);

      return res.status(response.status).json({
        error:
          data.error?.message ||
          "Gemini API request failed."
      });
    }

    /* EXTRACT RESPONSE */

    const reply = (data.steps || [])
      .filter(step => step.type === "model_output")
      .flatMap(step => step.content || [])
      .filter(item => item.type === "text")
      .map(item => item.text)
      .join("\n")
      .trim();

    if (!reply) {
      console.error("Empty Gemini response:", data);

      return res.status(503).json({
        error: "BYCO received an empty response from Gemini."
      });
    }

    console.log("Success using:", MODEL);

    return res.json({
      reply: reply
    });

  } catch (error) {
    console.error("BYCO Error:", error);

    if (error.name === "AbortError") {
      return res.status(504).json({
        error: "Gemini request timed out. Please try again."
      });
    }

    return res.status(500).json({
      error: "BYCO could not connect to AI."
    });

  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
});

/* SERVER */

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`BYCO server running on port ${PORT}`);
});
