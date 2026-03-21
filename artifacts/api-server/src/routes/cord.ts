import { Router, type IRouter } from "express";

const router: IRouter = Router();

const DEFAULT_GEMINI_KEY = "AIzaSyD75hG-17ef1_wn6IyuxB4tx7sMBLjSWEM";
const DEFAULT_ELEVENLABS_KEY = "sk_fea7edbe5a29cdc402614f2451d8d4daf3c5d8d407c3ec51";

const SYSTEM_PROMPT = `You are CORD, an ambient intelligence agent. The user is Priya, a chair of the NeurIPS Creative AI track. Summarise what needs her attention based on the notification context provided. Be concise, direct, and helpful. Max 4 sentences. Speak in second person ("you").`;

const MOCK_CONTEXT = `
Slack messages:
1. #creativeai-neurips-team: "Priya — can you confirm the Creative AI track schedule by EOD? We need it for the programme booklet"
2. #all-neurips-2025-organizers: "Reminder: keynote speaker bios due to comms team by Friday"
3. #creativeai-chairs: "Terri has reviewed the travel grant doc and left comments — needs your sign-off"

Emails:
1. From: max@eventhosts.cc — "Following up on the AV setup for the Creative AI exhibition space — awaiting confirmation"
2. From: submissions@neurips.cc — "14 new paper submissions assigned to your review queue"

Calendar:
- Today at 3pm GMT: NeurIPS Creative AI Track planning call
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

  const apiKey = geminiApiKey || process.env.GEMINI_API_KEY || DEFAULT_GEMINI_KEY;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
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

  const apiKey = elevenLabsApiKey || process.env.ELEVENLABS_API_KEY || DEFAULT_ELEVENLABS_KEY;

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
