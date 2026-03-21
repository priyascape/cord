import { Router, type IRouter } from "express";

const router: IRouter = Router();

const SYSTEM_PROMPT = `You are CORD, an ambient intelligence agent. The user has returned to their desk. Summarise what needs their attention across: 3 Slack messages, 2 emails, 1 calendar reminder. Be concise. Max 4 sentences.`;

const MOCK_CONTEXT = `
Slack messages:
1. From @sarah: "Can you review the Q3 report before EOD? I've left comments in the doc."
2. From @dev-channel: "Deploy to production is scheduled for 3pm. Need sign-off from leads."
3. From @james: "Quick call at 4pm? Want to sync on the roadmap priorities."

Emails:
1. From: client@company.com - Subject: "Contract renewal - urgent" - Sent 45 mins ago
2. From: noreply@calendar.com - Subject: "Reminder: All-hands meeting at 2pm today"

Calendar:
- 2:00 PM: All-hands team meeting (in 35 minutes) - Conference Room B
`;

router.post("/cord/ai", async (req, res) => {
  const { transcript, geminiApiKey } = req.body as {
    transcript?: string;
    geminiApiKey?: string;
  };

  if (!transcript) {
    res.status(400).json({ error: "bad_request", message: "transcript is required" });
    return;
  }

  const apiKey = geminiApiKey || process.env.GEMINI_API_KEY;

  if (!apiKey) {
    res.status(400).json({
      error: "no_api_key",
      message: "No Gemini API key configured. Please add one in the top-right input or set GEMINI_API_KEY env var.",
    });
    return;
  }

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro-latest:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: {
            parts: [{ text: SYSTEM_PROMPT }],
          },
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: `User said: "${transcript}"\n\nCurrent notification context:\n${MOCK_CONTEXT}`,
                },
              ],
            },
          ],
          generationConfig: {
            maxOutputTokens: 300,
            temperature: 0.7,
          },
        }),
      }
    );

    if (!response.ok) {
      const errorData = await response.text();
      req.log.error({ status: response.status, errorData }, "Gemini API error");
      res.status(500).json({ error: "gemini_error", message: `Gemini API error: ${response.status}` });
      return;
    }

    const data = await response.json() as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
      }>;
    };

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

    res.json({ response: text });
  } catch (err) {
    req.log.error({ err }, "Error calling Gemini API");
    res.status(500).json({ error: "internal_error", message: "Failed to call AI service" });
  }
});

router.post("/cord/tts", async (req, res) => {
  const { text, elevenLabsApiKey } = req.body as {
    text?: string;
    elevenLabsApiKey?: string;
  };

  if (!text) {
    res.status(400).json({ error: "bad_request", message: "text is required" });
    return;
  }

  const apiKey = elevenLabsApiKey || process.env.ELEVENLABS_API_KEY;

  if (!apiKey) {
    res.status(400).json({
      error: "no_api_key",
      message: "No ElevenLabs API key configured. Please add one in the top-right input or set ELEVENLABS_API_KEY env var.",
    });
    return;
  }

  const VOICE_ID = "21m00Tcm4TlvDq8ikWAM";

  try {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_monolingual_v1",
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
          },
        }),
      }
    );

    if (!response.ok) {
      const errorData = await response.text();
      req.log.error({ status: response.status, errorData }, "ElevenLabs API error");
      res.status(500).json({ error: "elevenlabs_error", message: `ElevenLabs API error: ${response.status}` });
      return;
    }

    const arrayBuffer = await response.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");

    res.json({ audioBase64: base64, contentType: "audio/mpeg" });
  } catch (err) {
    req.log.error({ err }, "Error calling ElevenLabs API");
    res.status(500).json({ error: "internal_error", message: "Failed to call TTS service" });
  }
});

export default router;
