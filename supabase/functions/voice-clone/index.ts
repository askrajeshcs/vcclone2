import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const REPLICATE_API_TOKEN = Deno.env.get("REPLICATE_API_TOKEN") ?? "";
const XTTS_VERSION = "684bc3855b37866c0c65add2ff39c78f3dea3f4ff103a436465326e0f438d55e";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { audioUrl, text, language, cleanupVoice } = await req.json();

    if (!audioUrl || !text) {
      return new Response(
        JSON.stringify({ error: "audioUrl and text are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supportedLanguages = ["en", "es", "fr", "de", "it", "pt", "cs", "pl", "ru", "nl", "tr", "ar", "zh-cn", "hi"];
    const lang = supportedLanguages.includes(language) ? language : "en";

    // Create a prediction on Replicate
    const createRes = await fetch("https://api.replicate.com/v1/predictions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${REPLICATE_API_TOKEN}`,
        "Content-Type": "application/json",
        "Prefer": "wait",
      },
      body: JSON.stringify({
        version: XTTS_VERSION,
        input: {
          speaker: audioUrl,
          text: text,
          language: lang,
          cleanup_voice: cleanupVoice ?? false,
        },
      }),
    });

    if (!createRes.ok) {
      const errBody = await createRes.text();
      console.error("Replicate create error:", createRes.status, errBody);
      return new Response(
        JSON.stringify({ error: "Failed to start voice synthesis. Please try again." }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const prediction = await createRes.json();

    // If not done yet, poll until complete
    let result = prediction;
    let pollCount = 0;
    const maxPolls = 60;

    while (result.status !== "succeeded" && result.status !== "failed" && result.status !== "canceled") {
      if (pollCount >= maxPolls) {
        return new Response(
          JSON.stringify({ error: "Voice synthesis timed out. Please try again." }),
          { status: 504, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));

      const pollRes = await fetch(`https://api.replicate.com/v1/predictions/${result.id}`, {
        headers: { "Authorization": `Bearer ${REPLICATE_API_TOKEN}` },
      });

      if (!pollRes.ok) {
        const errBody = await pollRes.text();
        console.error("Replicate poll error:", pollRes.status, errBody);
        return new Response(
          JSON.stringify({ error: "Failed to check voice synthesis status." }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      result = await pollRes.json();
      pollCount++;
    }

    if (result.status === "failed" || result.status === "canceled") {
      return new Response(
        JSON.stringify({ error: "Voice synthesis failed. Please check your audio sample quality and try again." }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // result.output is a URL to the audio file
    const outputUrl = result.output;

    // Fetch the audio and return it as base64 so the frontend can play it directly
    const audioRes = await fetch(outputUrl);
    if (!audioRes.ok) {
      return new Response(
        JSON.stringify({ error: "Failed to retrieve generated audio." }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const audioBuffer = await audioRes.arrayBuffer();
    const audioBase64 = btoa(String.fromCharCode(...new Uint8Array(audioBuffer)));

    return new Response(
      JSON.stringify({
        audio: `data:audio/wav;base64,${audioBase64}`,
        status: "succeeded",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Edge function error:", err);
    return new Response(
      JSON.stringify({ error: "Something went wrong. Please try again." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
