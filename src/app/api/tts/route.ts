import { NextRequest, NextResponse } from "next/server";
import { TTSClient, Config, HeaderUtils } from "coze-coding-dev-sdk";
import { getCharacterById } from "@/lib/characters";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const { text, characterId, uid } = await request.json();

    if (!text || !characterId) {
      return NextResponse.json({ error: "缺少参数" }, { status: 400 });
    }

    const character = getCharacterById(characterId);
    if (!character) {
      return NextResponse.json({ error: "角色不存在" }, { status: 400 });
    }

    const customHeaders = HeaderUtils.extractForwardHeaders(request.headers);
    const config = new Config();
    const client = new TTSClient(config, customHeaders);

    const response = await client.synthesize({
      uid: uid || "anonymous",
      text: text.slice(0, 200), // 限制长度，省配额
      speaker: character.voice,
      audioFormat: "mp3",
      sampleRate: 24000,
    });

    return NextResponse.json({
      audioUri: response.audioUri,
      audioSize: response.audioSize,
    });
  } catch (error) {
    console.error("TTS API error:", error);
    return NextResponse.json({ error: "语音生成失败" }, { status: 500 });
  }
}
