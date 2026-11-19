
const express = require("express");
const cors = require("cors");
require("dotenv").config();

const app = express();

app.use(cors());

// Image upload ke liye JSON limit
app.use(express.json({ limit: "12mb" }));

app.use(express.static(__dirname));

/* GEMINI MODELS */

const MODELS = [
  {
    name: "gemini-2.5-flash",
    timeout: 45000
  },
  {
    name: "gemini-2.5-flash-lite",
    timeout: 45000
  }
];

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
- You can analyze images uploaded by the user.
- Describe visible objects, diagrams, text and details.
- Help explain educational diagrams and screenshots.
- Read visible text when possible.
- Solve educational questions shown in images.
- If an image is unclear, tell the user honestly.
- Never pretend to see details that are not visible.

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

/* CHAT API */

app.post("/api/chat", async (req, res) => {

  try {

    const {
      message,
      language,
      history,
      image
    } = req.body;

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

    /* PREPARE HISTORY */

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
            parts: [
              {
                text: item.text.slice(0, 12000)
              }
            ]
          });

        }

      }

    }

    /* CURRENT USER MESSAGE */

    const parts = [];

    /* IMAGE VALIDATION AND PROCESSING */

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

      parts.push({
        inlineData: {
          mimeType: mimeType,
          data: base64Data
        }
      });

    }

    /* TEXT PROMPT */

    const prompt = `
Preferred language: ${language || "Automatically detect"}

${hasMessage ? message.trim() : "Please analyze this uploaded image and explain what you can see."}
`;

    parts.push({
      text: prompt
    });

    contents.push({
      role: "user",
      parts: parts
    });

    /* TRY GEMINI MODELS */

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
                parts: [
                  {
                    text: SYSTEM_INSTRUCTION
                  }
                ]
              },

              contents: contents,

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

        /* EXTRACT AI RESPONSE */

        const reply = (data.candidates || [])
          .flatMap(candidate => candidate.content?.parts || [])
          .filter(part => typeof part.text === "string")
          .map(part => part.text)
          .join("\n")
          .trim();

        if (reply) {

          console.log("Success using:", model.name);

          return res.json({
            reply: reply
          });

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

/* SERVER */

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {

  console.log(`BYCO server running on port ${PORT}`);

});
