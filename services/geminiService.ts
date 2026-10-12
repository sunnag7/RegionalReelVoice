import { GoogleGenAI, Modality, HarmCategory, HarmBlockThreshold } from "@google/genai";

let ai: GoogleGenAI | null = null;

const getAiClient = (): GoogleGenAI => {
    if (!ai) {
        if (!process.env.API_KEY) {
            throw new Error("API_KEY environment variable not set. Please configure your API key.");
        }
        ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    }
    return ai;
};

interface GenerateSpeechOptions {
  script: string;
  language: string;
  voice: string;
  emotion: string;
  speed: number;
}

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const generateSpeech = async (options: GenerateSpeechOptions): Promise<string | null> => {
  const { script, language, voice, emotion, speed } = options;

  // Cleaning: remove HTML tags, normalize quotes, keep standard punctuation
  // Specifically remove emojis and unusual symbols that often trigger 'OTHER' refusals in TTS
  const cleanScript = script
    .replace(/<[^>]+>|\[.*?\]/g, '')
    .replace(/[""]/g, "'")
    // Keep letters (any script), numbers, basic punctuation, and whitespace
    // Updated regex to be more restrictive for the most robust tier
    .replace(/[^\p{L}\p{N}\p{P}\s]/gu, '')
    .trim();

  if (!cleanScript) {
      throw new Error("The script is empty or contains only unsupported characters.");
  }

  const client = getAiClient();

  /**
   * Helper to build increasingly simple prompts.
   * "Reason: OTHER" usually occurs because the model triggers safety/mimicry/recitation blocks 
   * on complex instructions or certain word patterns. Fallback ensures the user gets audio regardless.
   */
  const buildPrompt = (attempt: number): string => {
      let directives = "Act as a professional voice artist. Adhere strictly to the requested accent. Output ONLY audio, move directly to speaking. ";
      
      if (language.includes('Marathi')) {
          directives += "Pay extra attention to 'aa' endings; for example, the name 'Ankita' must be pronounced clearly as 'An-ki-taa', not 'An-kat'. Ensure no word endings are clipped. ";
      }

      if (attempt === 4) {
          // Tier 4: Minimalist - just the text
          return cleanScript;
      }

      if (attempt === 3) {
          // Tier 3: Simple language marker + Text
          const langBase = language.includes('Marathi') ? 'Marathi' : (language.includes('Konkani') ? 'Konkani' : 'English');
          return `${langBase}: ${cleanScript}`;
      }

      if (attempt === 2) {
          // Tier 2: Directives + Simple Language Marker + Text
          const langBase = language.includes('Marathi') ? 'Marathi' : (language.includes('Konkani') ? 'Konkani' : 'English');
          return `${directives} Language: ${langBase}. Text: ${cleanScript}`;
      }

      // Tier 1: Primary descriptive prompt with Tone and Accent markers
      let prefix = "";
      const toneStr = emotion !== 'Normal' ? `with a ${emotion.toLowerCase()} tone` : "";
      const speedStr = speed !== 1.0 ? `at ${speed}x speed` : "";
      
      switch (language) {
        case 'Konkani':
        case 'Konkani-Roman':
          prefix = `Speak in Konkani ${toneStr || speedStr ? `(${[toneStr, speedStr].filter(Boolean).join(', ')})` : ""}: `;
          break;
        case 'Marathi':
        case 'Marathi-Roman':
          prefix = `Speak in Marathi ${toneStr || speedStr ? `(${[toneStr, speedStr].filter(Boolean).join(', ')})` : ""}: `;
          break;
        case 'English':
          prefix = `Speak in a clear, authentic Indian English accent ${toneStr || speedStr ? `(${[toneStr, speedStr].filter(Boolean).join(', ')})` : ""}: `;
          break;
        default:
          prefix = `Speak the following text ${toneStr || speedStr ? `(${[toneStr, speedStr].filter(Boolean).join(', ')})` : ""}: `;
          break;
      }

      return `${directives} ${prefix}${cleanScript}`;
  };

  const makeRequest = async (prompt: string, isLastAttempt: boolean): Promise<string | null> => {
    try {
        const response = await client.models.generateContent({
            model: "gemini-3.1-flash-tts-preview",
            contents: [{ parts: [{ text: prompt }] }],
            config: {
                responseModalities: [Modality.AUDIO],
                speechConfig: {
                    voiceConfig: {
                        prebuiltVoiceConfig: { voiceName: voice },
                    },
                },
                // Set safety settings to maximum tolerance
                safetySettings: [
                    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
                    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
                    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                ],
            },
        });

        const candidate = response.candidates?.[0];
        if (!candidate) throw new Error("Empty response candidate.");

        if (candidate.finishReason === 'SAFETY') {
            throw new Error("Content blocked by safety filters. Try simplifying your script.");
        }
        
        // Handle Gemini "OTHER" or "RECITATION" refusals by triggering a simpler retry
        if (candidate.finishReason === 'OTHER' || candidate.finishReason === 'RECITATION') {
             if (isLastAttempt) {
                 throw new Error(`The model refused to generate audio for this script (Reason: ${candidate.finishReason}). This can happen with complex text or certain word patterns. Try a simpler version.`);
             }
             return null; // Signals the loop to try the next fallback tier
        }

        // Extract raw PCM bytes from the inlineData part
        let base64Audio = null;
        if (candidate.content?.parts) {
            for (const part of candidate.content.parts) {
                if (part.inlineData?.data) {
                    base64Audio = part.inlineData.data;
                    break;
                }
            }
        }

        if (base64Audio) return base64Audio;
        
        // If the model returned text but no audio, and it's our last shot, we error out
        const textOutput = candidate.content?.parts?.find(p => p.text)?.text;
        if (textOutput && isLastAttempt) {
             throw new Error(`The model responded with text instead of audio. Your script might be triggering a content filter.`);
        }

        return null;

    } catch (error: any) {
        // Basic exponential backoff retry for Internal Server Errors (500)
        const isInternalError = error.message && (
            error.message.includes("500") || 
            error.message.includes("INTERNAL") || 
            error.message.includes("Internal error")
        );

        if (isInternalError) {
            if (!isLastAttempt) {
                // Wait longer for retry on server error
                await wait(2000);
                return null;
            }
        }
        throw error;
    }
  };

  // Iterative fallback loop
  const totalAttempts = 4;
  for (let i = 1; i <= totalAttempts; i++) {
      const prompt = buildPrompt(i);
      const result = await makeRequest(prompt, i === totalAttempts);
      if (result) return result;
  }

  throw new Error("Unable to generate audio. The script might contain restricted content or is too long for the current model.");
};