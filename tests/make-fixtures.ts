/**
 * Generates the media fixtures the live media test uses, with Gemini itself:
 * a product photo and a Singlish voice note. Run once - the files are committed
 * so `npm run test:media` is reproducible without regenerating them.
 *
 *   npm run fixtures
 *
 * Drop your own real WhatsApp voice notes into tests/fixtures/ alongside these
 * and they will be picked up; studio TTS is cleaner than a real customer in a
 * noisy street, so real recordings are the better test.
 */
import "dotenv/config";
import { GoogleGenAI } from "@google/genai";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const dir = "./tests/fixtures";
mkdirSync(dir, { recursive: true });

/** Gemini TTS returns raw signed 16-bit PCM; give it a WAV header. */
function wav(pcm: Buffer, sampleRate = 24000, channels = 1, bits = 16): Buffer {
  const header = Buffer.alloc(44);
  const byteRate = (sampleRate * channels * bits) / 8;
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE((channels * bits) / 8, 32);
  header.writeUInt16LE(bits, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function firstInlineData(response: unknown): { mimeType: string; data: string } | null {
  const parts =
    (response as { candidates?: Array<{ content?: { parts?: Array<Record<string, unknown>> } }> })
      .candidates?.[0]?.content?.parts ?? [];
  for (const part of parts) {
    const inline = part["inlineData"] as { mimeType?: string; data?: string } | undefined;
    if (inline?.data) return { mimeType: inline.mimeType ?? "", data: inline.data };
  }
  return null;
}

// ---------------------------------------------------------------- photo

const photoPath = `${dir}/black-tshirt.jpg`;
if (existsSync(photoPath) && !process.argv.includes("--force")) {
  console.log("photo: already present, skipping (use --force to regenerate)");
} else {
  console.log("generating product photo...");
  const response = await ai.models.generateContent({
    model: "gemini-3.1-flash-image",
    contents:
      "A plain black cotton crew-neck t-shirt laid flat on a white background. " +
      "Simple e-commerce product photo, no print or logo, soft even lighting, shot from above.",
    config: { responseModalities: ["IMAGE"] },
  });
  const inline = firstInlineData(response);
  if (!inline) throw new Error("no image returned");
  writeFileSync(photoPath, Buffer.from(inline.data, "base64"));
  console.log(`  wrote ${photoPath} (${inline.mimeType})`);
}

// ------------------------------------------------- photo of something we do not sell

const shoePath = `${dir}/running-shoes.jpg`;
if (existsSync(shoePath) && !process.argv.includes("--force")) {
  console.log("negative photo: already present, skipping");
} else {
  console.log("generating a photo of something the shop does not sell...");
  const response = await ai.models.generateContent({
    model: "gemini-3.1-flash-image",
    contents:
      "A pair of blue running shoes on a white background. " +
      "Simple e-commerce product photo, soft even lighting, shot from above.",
    config: { responseModalities: ["IMAGE"] },
  });
  const inline = firstInlineData(response);
  if (!inline) throw new Error("no image returned");
  writeFileSync(shoePath, Buffer.from(inline.data, "base64"));
  console.log(`  wrote ${shoePath}`);
}

// ---------------------------------------------------------------- voice note

const voicePath = `${dir}/voice-order.wav`;
if (existsSync(voicePath) && !process.argv.includes("--force")) {
  console.log("voice note: already present, skipping (use --force to regenerate)");
} else {
  console.log("generating Singlish voice note...");
  const line = "Hello, mata plain cotton t-shirt ekak oney. L size, black colour. Kiyada?";
  // This model intermittently returns finishReason OTHER with no audio at all,
  // for input it accepted a moment earlier. Retry rather than fail the run.
  let inline: { mimeType: string; data: string } | null = null;
  for (let attempt = 1; attempt <= 4 && !inline; attempt++) {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: line,
      config: {
        responseModalities: ["AUDIO"],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } },
      },
    });
    inline = firstInlineData(response);
    if (!inline) console.log(`  attempt ${attempt}: no audio returned, retrying`);
  }
  if (!inline) throw new Error("TTS returned no audio after 4 attempts");
  const pcm = Buffer.from(inline.data, "base64");
  writeFileSync(voicePath, wav(pcm));
  console.log(`  wrote ${voicePath} (${pcm.length} bytes PCM -> wav)`);
  writeFileSync(`${dir}/voice-order.txt`, line + "\n");
  console.log(`  wrote ${dir}/voice-order.txt (what was said, for comparison)`);
}

console.log("\ndone.");
